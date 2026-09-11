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

/// @notice Official REACTOR hook. 0% LP fee pool; 3% quote-side custom accounting.
contract ReactorHook is IHooks, IUnlockCallback {
    using SafeCast for uint256;

    IPoolManager public immutable poolManager;
    QuoteAssetRegistry public immutable registry;
    address public immutable core;
    address public immutable liquidityVault;
    BuybackVault public buybackVault;
    address public factory;

    struct OfficialMarket {
        address token;
        address quote;
        bool exists;
    }

    mapping(PoolId => OfficialMarket) public official;
    mapping(address => uint256) public pendingTokenRewards;
    mapping(address => uint256) public pendingBuyback;

    event OfficialPoolCreated(PoolId indexed poolId, address indexed token, address indexed quote);
    event SwapFeeAccrued(PoolId indexed poolId, address indexed quote, uint256 holders, uint256 buyback, uint256 notional);

    error NotPoolManager();
    error NotFactory();
    error AlreadyBound();
    error HookNotImplemented();
    error InvalidPool();
    error CoreForbidden();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(
        IPoolManager manager_,
        QuoteAssetRegistry registry_,
        address core_,
        address liquidityVault_
    ) {
        poolManager = manager_;
        registry = registry_;
        core = core_;
        liquidityVault = liquidityVault_;
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
        if (factory != address(0)) revert AlreadyBound();
        if (factory_ == address(0)) revert NotFactory();
        factory = factory_;
    }

    function bindBuyback(BuybackVault vault_) external {
        if (address(buybackVault) != address(0)) revert AlreadyBound();
        if (address(vault_) == address(0)) revert NotFactory();
        buybackVault = vault_;
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
        if (sender != factory) revert NotFactory();
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
        official[id] = OfficialMarket({token: token, quote: quote, exists: true});
        emit OfficialPoolCreated(id, token, quote);
        return IHooks.afterInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        OfficialMarket memory m = official[key.toId()];
        if (!m.exists) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        address specified = specifiedIs0 ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        if (specified != m.quote) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        uint256 notional =
            params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        (uint256 holders, uint256 buyback, uint256 fee) = FeeMath.split(notional);
        if (fee == 0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        poolManager.mint(address(this), specifiedIs0 ? key.currency0.toId() : key.currency1.toId(), fee);
        _distribute(key.toId(), m, holders, buyback, notional);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(fee)), 0), 0);
    }

    function afterSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        OfficialMarket memory m = official[key.toId()];
        if (!m.exists) return (IHooks.afterSwap.selector, 0);

        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        address specified = specifiedIs0 ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        if (specified == m.quote) {
            return (IHooks.afterSwap.selector, 0);
        }

        int128 quoteDelta = specifiedIs0 ? delta.amount1() : delta.amount0();
        if (quoteDelta < 0) quoteDelta = -quoteDelta;
        (uint256 holders, uint256 buyback, uint256 fee) = FeeMath.split(uint256(uint128(quoteDelta)));
        if (fee == 0) return (IHooks.afterSwap.selector, 0);
        Currency quoteC = specifiedIs0 ? key.currency1 : key.currency0;
        poolManager.mint(address(this), quoteC.toId(), fee);
        _distribute(key.toId(), m, holders, buyback, uint256(uint128(quoteDelta)));
        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    function _distribute(PoolId id, OfficialMarket memory m, uint256 holders, uint256 buyback, uint256 notional)
        internal
    {
        if (holders > 0) {
            pendingTokenRewards[m.token] += holders;
            IReactorToken(m.token).creditRewards(holders);
        }
        if (buyback > 0) {
            pendingBuyback[m.quote] += buyback;
            buybackVault.accrue(m.quote, buyback);
        }
        emit SwapFeeAccrued(id, m.quote, holders, buyback, notional);
    }

    /// @notice Convert ERC-6909 fee claims to ERC-20. Call after the swapper settled (same unlock or later).
    function flush(address quote, address token) external {
        uint256 claimAmt = poolManager.balanceOf(address(this), uint256(uint160(quote)));
        if (claimAmt > 0) {
            try poolManager.take(Currency.wrap(quote), address(this), claimAmt) {
                poolManager.burn(address(this), uint256(uint160(quote)), claimAmt);
            } catch {
                poolManager.unlock(abi.encode(quote, claimAmt));
            }
        }
        _payout(quote, token);
    }

    function _payout(address quote, address token) internal {
        uint256 toToken = pendingTokenRewards[token];
        uint256 toBuy = pendingBuyback[quote];
        uint256 have = IERC20MinimalExt(quote).balanceOf(address(this));
        if (toToken > 0 && have > 0) {
            uint256 send = toToken < have ? toToken : have;
            pendingTokenRewards[token] = toToken - send;
            IERC20MinimalExt(quote).transfer(token, send);
            have -= send;
        }
        if (toBuy > 0 && have > 0) {
            uint256 send = toBuy < have ? toBuy : have;
            pendingBuyback[quote] = toBuy - send;
            IERC20MinimalExt(quote).transfer(address(buybackVault), send);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address quote, uint256 amt) = abi.decode(data, (address, uint256));
        poolManager.take(Currency.wrap(quote), address(this), amt);
        poolManager.burn(address(this), uint256(uint160(quote)), amt);
        return "";
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

    function beforeRemoveLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
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