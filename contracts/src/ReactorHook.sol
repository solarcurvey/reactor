// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {IReactorToken} from "./interfaces/IReactorToken.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {BuybackVault} from "./BuybackVault.sol";
import {IFeeSink} from "./interfaces/IFeeSink.sol";
import {ReactorRouter} from "./ReactorRouter.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";

interface IFactoryView {
    function router() external view returns (ReactorRouter);
    function isRewards(address token) external view returns (bool);
}

interface ISelfBurnSink {
    function accrue(address token, address quote, uint256 amount) external;
}

/// @notice Official REACTOR hook. 0% LP fee pool; 3.5% quote-side custom accounting.
contract ReactorHook is IHooks, IUnlockCallback {
    using SafeCast for uint256;

    IPoolManager public immutable poolManager;
    QuoteAssetRegistry public immutable registry;
    address public immutable core;
    address public immutable liquidityVault;
    BuybackVault public buybackVault;
    IFeeSink public flywheelVault;
    ISelfBurnSink public selfBurn;
    address public factory;
    address public curve;
    address public immutable bootstrap;
    ReactorGuardian public immutable auth;

    struct OfficialMarket {
        address token;
        address quote;
        bool exists;
    }

    mapping(PoolId => OfficialMarket) public official;
    mapping(address => OfficialMarket) public marketOfToken;
    mapping(address => uint256) public pendingTokenRewards;
    mapping(address => uint256) public pendingSelfBurn;
    mapping(address => uint256) public pendingBuyback;
    mapping(address => uint256) public pendingFlywheel;
    mapping(address => uint256) public pendingCore;

    event OfficialPoolCreated(PoolId indexed poolId, address indexed token, address indexed quote);
    event SwapFeeAccrued(
        PoolId indexed poolId,
        address indexed quote,
        uint256 holders,
        uint256 flywheel,
        uint256 coreAmt,
        uint256 notional
    );

    error NotPoolManager();
    error NotFactory();
    error AlreadyBound();
    error HookNotImplemented();
    error InvalidPool();
    error CoreForbidden();
    error QuoteMismatch();
    error UnknownLaunch();
    error NotOwner();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(
        IPoolManager manager_,
        QuoteAssetRegistry registry_,
        address core_,
        address liquidityVault_,
        address bootstrap_,
        ReactorGuardian auth_
    ) {
        poolManager = manager_;
        registry = registry_;
        core = core_;
        liquidityVault = liquidityVault_;
        bootstrap = bootstrap_ == address(0) ? msg.sender : bootstrap_;
        auth = auth_;
        Hooks.validateHookPermissions(
            this,
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: true,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    function bindFactory(address factory_) external {
        if (msg.sender != bootstrap) revert NotOwner();
        if (factory != address(0)) revert AlreadyBound();
        if (factory_ == address(0)) revert NotFactory();
        factory = factory_;
    }

    function bindBuyback(BuybackVault vault_) external {
        if (msg.sender != bootstrap) revert NotOwner();
        if (address(buybackVault) != address(0)) revert AlreadyBound();
        if (address(vault_) == address(0)) revert NotFactory();
        buybackVault = vault_;
    }

    function bindFlywheel(IFeeSink vault_) external {
        if (msg.sender != bootstrap) revert NotOwner();
        if (address(flywheelVault) != address(0)) revert AlreadyBound();
        if (address(vault_) == address(0)) revert NotFactory();
        flywheelVault = vault_;
    }

    function bindCurve(address curve_) external {
        if (msg.sender != bootstrap) revert NotOwner();
        if (curve != address(0)) revert AlreadyBound();
        if (curve_ == address(0)) revert NotFactory();
        curve = curve_;
    }

    function bindSelfBurn(address vault_) external {
        if (msg.sender != bootstrap) revert NotOwner();
        if (address(selfBurn) != address(0)) revert AlreadyBound();
        if (vault_ == address(0)) revert NotFactory();
        selfBurn = ISelfBurnSink(vault_);
    }

    function hookFlags() public pure returns (uint160) {
        return uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160)
        external
        view
        override
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != factory && sender != curve) revert NotFactory();
        if (key.fee != ReactorConstants.LP_FEE) revert InvalidPool();
        if (key.tickSpacing != ReactorConstants.TICK_SPACING) revert InvalidPool();

        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (c0 == core || c1 == core) revert CoreForbidden();

        bool q0 = registry.isEnabled(c0);
        bool q1 = registry.isEnabled(c1);
        if (q0 == q1) revert InvalidPool();
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24)
        external
        override
        onlyPoolManager
        returns (bytes4)
    {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        address quote = registry.isEnabled(c0) ? c0 : c1;
        address token = quote == c0 ? c1 : c0;
        PoolId id = key.toId();
        OfficialMarket memory m = OfficialMarket({token: token, quote: quote, exists: true});
        official[id] = m;
        marketOfToken[token] = m;
        emit OfficialPoolCreated(id, token, quote);
        return IHooks.afterInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        auth.requireTradingOpen();
        OfficialMarket memory m = official[key.toId()];
        if (!m.exists) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        if (_protocolExempt()) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        address specified = specifiedIs0 ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        if (specified != m.quote) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 notional =
            params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        (uint256 holders, uint256 flywheel, uint256 coreAmt, uint256 fee) = FeeMath.split(notional);
        if (fee == 0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        poolManager.mint(address(this), specifiedIs0 ? key.currency0.toId() : key.currency1.toId(), fee);
        _distribute(key.toId(), m, holders, flywheel, coreAmt, notional);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        OfficialMarket memory m = official[key.toId()];
        if (!m.exists) return (IHooks.afterSwap.selector, 0);
        if (_protocolExempt()) return (IHooks.afterSwap.selector, 0);

        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        address specified = specifiedIs0 ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        if (specified == m.quote) {
            return (IHooks.afterSwap.selector, 0);
        }

        int128 quoteDelta = specifiedIs0 ? delta.amount1() : delta.amount0();
        if (quoteDelta < 0) quoteDelta = -quoteDelta;
        (uint256 holders, uint256 flywheel, uint256 coreAmt, uint256 fee) = FeeMath.split(uint256(uint128(quoteDelta)));
        if (fee == 0) return (IHooks.afterSwap.selector, 0);
        Currency quoteC = specifiedIs0 ? key.currency1 : key.currency0;
        poolManager.mint(address(this), quoteC.toId(), fee);
        _distribute(key.toId(), m, holders, flywheel, coreAmt, uint256(uint128(quoteDelta)));
        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    function _distribute(
        PoolId id,
        OfficialMarket memory m,
        uint256 holders,
        uint256 flywheel,
        uint256 coreAmt,
        uint256 notional
    ) internal {
        if (holders > 0) {
            if (factory != address(0) && IFactoryView(factory).isRewards(m.token)) {
                pendingTokenRewards[m.token] += holders;
                IReactorToken(m.token).creditRewards(holders);
            } else if (address(selfBurn) != address(0)) {
                pendingSelfBurn[m.token] += holders;
            } else {
                pendingTokenRewards[m.token] += holders;
                IReactorToken(m.token).creditRewards(holders);
            }
        }
        if (flywheel > 0 && address(flywheelVault) != address(0)) {
            pendingFlywheel[m.quote] += flywheel;
            flywheelVault.accrue(m.quote, flywheel);
        }
        if (coreAmt > 0) {
            pendingCore[m.quote] += coreAmt;
            pendingBuyback[m.quote] += coreAmt;
            buybackVault.accrue(m.quote, coreAmt);
        }
        emit SwapFeeAccrued(id, m.quote, holders, flywheel, coreAmt, notional);
    }

    /// @notice Convert fee claims for a launch token. Quote is derived from official state.
    function flush(address token) public {
        OfficialMarket memory m = marketOfToken[token];
        if (!m.exists) revert UnknownLaunch();
        _flush(m.quote, token);
    }

    /// @notice Two-arg form kept so callers can be explicit. Reverts on cross-quote pairing.
    function flush(address quote, address token) public {
        OfficialMarket memory m = marketOfToken[token];
        if (!m.exists) revert UnknownLaunch();
        if (quote != m.quote) revert QuoteMismatch();
        _flush(quote, token);
    }

    function _flush(address quote, address token) internal {
        uint256 need =
            pendingTokenRewards[token] + pendingSelfBurn[token] + pendingFlywheel[quote] + pendingCore[quote];
        uint256 claimAmt = poolManager.balanceOf(address(this), uint256(uint160(quote)));
        if (need > 0 && claimAmt > need) claimAmt = need;
        if (claimAmt > 0) {
            poolManager.unlock(abi.encode(quote, claimAmt));
        }
        _payout(quote, token);
    }

    function _payout(address quote, address token) internal {
        uint256 toToken = pendingTokenRewards[token];
        uint256 toSelf = pendingSelfBurn[token];
        uint256 toFly = pendingFlywheel[quote];
        uint256 toCore = pendingCore[quote];
        uint256 have = IERC20MinimalExt(quote).balanceOf(address(this));
        if (toToken > 0 && have > 0) {
            uint256 send = toToken < have ? toToken : have;
            pendingTokenRewards[token] = toToken - send;
            IERC20MinimalExt(quote).transfer(token, send);
            have -= send;
        }
        if (toSelf > 0 && have > 0 && address(selfBurn) != address(0)) {
            uint256 send = toSelf < have ? toSelf : have;
            pendingSelfBurn[token] = toSelf - send;
            selfBurn.accrue(token, quote, send);
            IERC20MinimalExt(quote).transfer(address(selfBurn), send);
            have -= send;
        }
        if (toFly > 0 && have > 0 && address(flywheelVault) != address(0)) {
            uint256 send = toFly < have ? toFly : have;
            pendingFlywheel[quote] = toFly - send;
            IERC20MinimalExt(quote).transfer(address(flywheelVault), send);
            have -= send;
        }
        if (toCore > 0 && have > 0) {
            uint256 send = toCore < have ? toCore : have;
            pendingCore[quote] = toCore - send;
            pendingBuyback[quote] = toCore - send;
            IERC20MinimalExt(quote).transfer(address(buybackVault), send);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address quote, uint256 amt) = abi.decode(data, (address, uint256));
        // Burn 6909 first to credit the locker, then take ERC-20.
        poolManager.burn(address(this), uint256(uint160(quote)), amt);
        poolManager.take(Currency.wrap(quote), address(this), amt);
        return "";
    }

    function _protocolExempt() internal view returns (bool) {
        if (factory == address(0)) return false;
        return IFactoryView(factory).router().protocolExempt() == 1;
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
