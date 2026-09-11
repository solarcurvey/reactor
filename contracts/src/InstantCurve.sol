// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {ReactorToken} from "./ReactorToken.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {ReactorRouter} from "./ReactorRouter.sol";
import {ReactorLiquidityVault} from "./ReactorLiquidityVault.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {SelfBurnVault} from "./SelfBurnVault.sol";
import {IFeeSink} from "./interfaces/IFeeSink.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {CurveMath} from "./libraries/CurveMath.sol";
import {LaunchMath} from "./libraries/LaunchMath.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";
import {ReactorConstants} from "./ReactorConstants.sol";

interface IInstantFactory {
    function creditTokenRewards(address token, uint256 amount) external;
    function onGraduated(address token, PoolId poolId) external;
}

/// @notice Protocol bonding curve. 79.31% inventory; 20.69% + economic quote graduate to locked v4.
contract InstantCurve {
    using StateLibrary for IPoolManager;

    IInstantFactory public immutable factory;
    ReactorHook public immutable hook;
    ReactorRouter public immutable router;
    ReactorLiquidityVault public immutable vault;
    QuoteAssetRegistry public immutable registry;
    IPoolManager public immutable poolManager;
    address public immutable usdc;
    ReactorGuardian public immutable auth;
    SelfBurnVault public selfBurn;

    struct Curve {
        address token;
        address quote;
        address creator;
        bool rewardsMode;
        bool graduated;
        bool ready;
        uint8 quoteDecimals;
        uint256 virtualQuote;
        uint256 virtualToken;
        uint256 realQuote;
        uint256 inventory;
        uint256 reservedLp;
        uint256 gradTarget;
        uint256 devBought;
        uint256 vOff;
    }

    mapping(address => Curve) public curves;

    event InstantLaunchCreated(
        address indexed token, address indexed quote, address indexed creator, bool rewardsMode, uint256 gradTarget
    );
    event DevBuyExecuted(address indexed token, address indexed creator, uint256 quoteIn, uint256 tokensOut);
    event CurveBuy(address indexed token, address indexed buyer, uint256 quoteIn, uint256 tokensOut, uint256 fee);
    event CurveSell(address indexed token, address indexed seller, uint256 tokensIn, uint256 quoteOut, uint256 fee);
    event BondingProgress(address indexed token, uint256 realQuote, uint256 gradTarget, uint256 inventory);
    event GraduationTriggered(address indexed token, uint256 realQuote);
    event GraduationCompleted(address indexed token, PoolId indexed poolId, uint256 quoteLp, uint256 tokenLp);
    event QuoteRouted(address indexed token, address indexed user, address tokenIn, address tokenOut, uint256 amountIn);

    error NotFactory();
    error Bad();
    error Graduated();
    error NotReady();
    error ReadyLocked();
    error TerminalMismatch();
    error DevBuyCap();
    error Slippage();
    error NotExempt();
    error MinOutRequired();

    modifier onlyFactory() {
        if (msg.sender != address(factory)) revert NotFactory();
        _;
    }

    constructor(
        IInstantFactory factory_,
        ReactorHook hook_,
        ReactorRouter router_,
        ReactorLiquidityVault vault_,
        QuoteAssetRegistry registry_,
        IPoolManager pm,
        ReactorGuardian auth_
    ) {
        factory = factory_;
        hook = hook_;
        router = router_;
        vault = vault_;
        registry = registry_;
        poolManager = pm;
        usdc = registry_.usdc();
        auth = auth_;
    }

    function bindSelfBurn(SelfBurnVault s) external {
        if (msg.sender != address(factory)) revert NotFactory();
        if (address(selfBurn) != address(0)) revert Bad();
        selfBurn = s;
    }

    function open(
        address token,
        address quote,
        address creator,
        bool rewardsMode,
        uint8 quoteDecimals,
        uint256 supply,
        uint256 virtualQuote0
    ) external onlyFactory {
        if (curves[token].token != address(0)) revert Bad();
        if (virtualQuote0 == 0) revert Bad();
        (uint256 inv, uint256 lp) = CurveMath.inventories(supply);
        uint256 vOff = CurveMath.virtualOffset(inv, lp);
        uint256 q0 = virtualQuote0;
        curves[token] = Curve({
            token: token,
            quote: quote,
            creator: creator,
            rewardsMode: rewardsMode,
            graduated: false,
            ready: false,
            quoteDecimals: quoteDecimals,
            virtualQuote: q0,
            virtualToken: inv + vOff,
            realQuote: 0,
            inventory: inv,
            reservedLp: lp,
            gradTarget: CurveMath.gradTarget(q0, inv, vOff),
            devBought: 0,
            vOff: vOff
        });
        emit InstantLaunchCreated(token, quote, creator, rewardsMode, CurveMath.gradTarget(q0, inv, vOff));
    }

    function buy(address token, uint256 quoteIn, uint256 minOut) external returns (uint256 tokensOut) {
        auth.requireTradingOpen();
        return _buy(token, msg.sender, quoteIn, minOut, false, false);
    }

    function buyFor(address token, address user, uint256 quoteIn, uint256 minOut)
        external
        returns (uint256 tokensOut)
    {
        if (msg.sender != address(factory) && msg.sender != user) revert Bad();
        return _buy(token, user, quoteIn, minOut, false, false);
    }

    /// @notice Quote already on this contract. Recipient is `user`. Used by UserRoute (bonding USDC path).
    function buyPrefunded(address token, address user, uint256 quoteIn, uint256 minOut)
        external
        returns (uint256 tokensOut)
    {
        auth.requireTradingOpen();
        return _buy(token, user, quoteIn, minOut, false, true);
    }

    function buyExempt(address token, uint256 quoteIn, uint256 minOut) external returns (uint256 tokensOut) {
        if (!router.protocolVault(msg.sender)) revert NotExempt();
        return _buy(token, msg.sender, quoteIn, minOut, true, false);
    }

    function sell(address token, uint256 tokenIn, uint256 minOut) external returns (uint256 quoteOut) {
        auth.requireTradingOpen();
        Curve storage c = curves[token];
        if (c.ready) revert ReadyLocked();
        return _sell(token, msg.sender, tokenIn, minOut, false, true);
    }

    function sellExempt(address token, uint256 tokenIn, uint256 minOut) external returns (uint256 quoteOut) {
        if (!router.protocolVault(msg.sender)) revert NotExempt();
        if (curves[token].ready) revert ReadyLocked();
        return _sell(token, msg.sender, tokenIn, minOut, true, true);
    }

    function launchDevBuy(address token, address creator, uint256 quoteIn)
        external
        onlyFactory
        returns (uint256 tokensOut)
    {
        // Fees first while creator has no tokens → Rewards leftover carries; no historic credit.
        tokensOut = _buy(token, creator, quoteIn, 1, false, true);
        if (tokensOut > ReactorConstants.DEV_BUY_MAX_TOKENS) revert DevBuyCap();
        curves[token].devBought = tokensOut;
        emit DevBuyExecuted(token, creator, quoteIn, tokensOut);
    }

    function graduate(address token) external returns (PoolId poolId) {
        Curve storage c = curves[token];
        if (c.token == address(0) || c.graduated) revert Bad();
        if (!c.ready) revert NotReady();
        _revalidateTerminal(c);
        emit GraduationTriggered(token, c.realQuote);

        uint256 quoteLp = c.realQuote;
        uint256 tokenLp = c.reservedLp;
        c.realQuote = 0;
        c.reservedLp = 0;
        c.graduated = true;

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token < c.quote ? token : c.quote),
            currency1: Currency.wrap(token < c.quote ? c.quote : token),
            fee: ReactorConstants.LP_FEE,
            tickSpacing: ReactorConstants.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        uint160 sqrtP = LaunchMath.sqrtPriceFromFdv(token, c.quote, tokenLp, quoteLp);
        poolManager.initialize(key, sqrtP);
        poolId = key.toId();

        int24 lo = TickMath.minUsableTick(ReactorConstants.TICK_SPACING);
        int24 hi = TickMath.maxUsableTick(ReactorConstants.TICK_SPACING);
        (uint160 sqrtNow,,,) = poolManager.getSlot0(poolId);
        uint256 amt0 = token < c.quote ? tokenLp : quoteLp;
        uint256 amt1 = token < c.quote ? quoteLp : tokenLp;
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtNow, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), amt0, amt1
        );
        IERC20MinimalExt(token).transfer(address(vault), tokenLp);
        IERC20MinimalExt(c.quote).transfer(address(vault), quoteLp);
        vault.lockLiquidity(key, lo, hi, int256(uint256(liq)));
        factory.onGraduated(token, poolId);
        emit GraduationCompleted(token, poolId, quoteLp, tokenLp);
    }

    function buyWithUsdc(address token, uint256 usdcIn, uint256 minTokenOut) external returns (uint256 tokensOut) {
        auth.requireTradingOpen();
        Curve storage c = curves[token];
        if (c.token == address(0)) revert Bad();
        IERC20MinimalExt(usdc).transferFrom(msg.sender, address(this), usdcIn);
        uint256 quoteIn = usdcIn;
        if (c.quote != usdc) {
            quoteIn = _hop(usdc, c.quote, usdcIn);
            if (quoteIn == 0) revert Slippage();
        }
        emit QuoteRouted(token, msg.sender, usdc, c.quote, usdcIn);
        if (c.graduated) {
            tokensOut = _v4Buy(c, quoteIn, minTokenOut, msg.sender);
        } else {
            tokensOut = _buy(token, msg.sender, quoteIn, minTokenOut, false, true);
        }
    }

    function sellToUsdc(address token, uint256 tokenIn, uint256 minUsdc) external returns (uint256 usdcOut) {
        auth.requireTradingOpen();
        Curve storage c = curves[token];
        uint256 quoteOut;
        if (c.graduated) {
            quoteOut = _v4Sell(c, tokenIn, 1, msg.sender, address(this));
        } else {
            quoteOut = _sell(token, msg.sender, tokenIn, 1, false, false);
        }
        if (c.quote == usdc) {
            if (quoteOut < minUsdc) revert Slippage();
            IERC20MinimalExt(usdc).transfer(msg.sender, quoteOut);
            return quoteOut;
        }
        usdcOut = _hop(c.quote, usdc, quoteOut);
        if (usdcOut < minUsdc) revert Slippage();
        IERC20MinimalExt(usdc).transfer(msg.sender, usdcOut);
        emit QuoteRouted(token, msg.sender, c.quote, usdc, quoteOut);
    }

    function quoteOf(address token) external view returns (address) {
        return curves[token].quote;
    }

    function virtualQuoteOf(address token) external view returns (uint256) {
        return curves[token].virtualQuote;
    }

    function existsOf(address token) external view returns (bool) {
        return curves[token].token != address(0);
    }

    function graduatedOf(address token) external view returns (bool) {
        return curves[token].graduated;
    }

    function readyOf(address token) external view returns (bool) {
        return curves[token].ready;
    }

    function inventoryOf(address token) external view returns (uint256) {
        return curves[token].inventory;
    }

    function reservedOf(address token) external view returns (uint256) {
        return curves[token].reservedLp;
    }

    function realQuoteOf(address token) external view returns (uint256) {
        return curves[token].realQuote;
    }

    function devBoughtOf(address token) external view returns (uint256) {
        return curves[token].devBought;
    }

    function gradTargetOf(address token) external view returns (uint256) {
        return curves[token].gradTarget;
    }

    function bondingPct(address token) external view returns (uint256 bps) {
        Curve storage c = curves[token];
        if (c.gradTarget == 0) return 0;
        if (c.realQuote >= c.gradTarget) return 10_000;
        return (c.realQuote * 10_000) / c.gradTarget;
    }

    function _buy(address token, address user, uint256 quoteIn, uint256 minOut, bool exempt, bool prefunded)
        internal
        returns (uint256 tokensOut)
    {
        Curve storage c = curves[token];
        if (c.token == address(0) || c.graduated) revert Graduated();
        if (c.ready) revert ReadyLocked();
        if (quoteIn == 0) revert Bad();
        if (minOut == 0) revert MinOutRequired();
        if (!prefunded) IERC20MinimalExt(c.quote).transferFrom(user, address(this), quoteIn);

        uint256 maxEcon = _maxEconomicIn(c);
        uint256 executedGross = quoteIn;
        uint256 fee;
        uint256 curveIn;
        if (!exempt) {
            if (maxEcon != type(uint256).max) {
                uint256 maxGross = FeeMath.maxGrossForNet(maxEcon);
                if (executedGross > maxGross) executedGross = maxGross;
            }
            (uint256 bucket2, uint256 fly, uint256 coreAmt, uint256 f) = FeeMath.split(executedGross);
            fee = f;
            curveIn = executedGross - fee;
            if (maxEcon != type(uint256).max && curveIn > maxEcon) curveIn = maxEcon;
            _payFees(c, bucket2, fly, coreAmt);
        } else {
            if (maxEcon != type(uint256).max && executedGross > maxEcon) executedGross = maxEcon;
            curveIn = executedGross;
        }
        if (executedGross < quoteIn) {
            IERC20MinimalExt(c.quote).transfer(user, quoteIn - executedGross);
        }

        (tokensOut, c.virtualQuote, c.virtualToken) = CurveMath.buyOut(c.virtualQuote, c.virtualToken, curveIn);
        if (tokensOut == 0 || tokensOut > c.inventory || tokensOut < minOut) revert Slippage();
        c.inventory -= tokensOut;
        c.realQuote += curveIn;
        if (_isTerminal(c)) c.ready = true;
        IERC20MinimalExt(token).transfer(user, tokensOut);
        emit CurveBuy(token, user, executedGross, tokensOut, fee);
        emit BondingProgress(token, c.realQuote, c.gradTarget, c.inventory);
    }

    function _maxEconomicIn(Curve storage c) internal view returns (uint256) {
        uint256 invCap = CurveMath.quoteInForTokens(c.virtualQuote, c.virtualToken, c.inventory);
        uint256 tgtCap = c.realQuote >= c.gradTarget ? 0 : c.gradTarget - c.realQuote;
        if (invCap == 0 || tgtCap == 0) return 0;
        if (invCap == type(uint256).max) return tgtCap;
        return invCap < tgtCap ? invCap : tgtCap;
    }

    function _isTerminal(Curve storage c) internal view returns (bool) {
        if (c.realQuote >= c.gradTarget || c.inventory == 0) return true;
        uint256 invCap = CurveMath.quoteInForTokens(c.virtualQuote, c.virtualToken, c.inventory);
        if (invCap == 0) return true;
        uint256 remain = c.gradTarget - c.realQuote;
        (uint256 dustTok,,) = CurveMath.buyOut(c.virtualQuote, c.virtualToken, remain);
        return dustTok == 0;
    }

    function _revalidateTerminal(Curve storage c) internal view {
        if (!_isTerminal(c)) revert TerminalMismatch();
        if (c.reservedLp == 0) revert TerminalMismatch();
        uint256 qBal = IERC20MinimalExt(c.quote).balanceOf(address(this));
        uint256 tBal = IERC20MinimalExt(c.token).balanceOf(address(this));
        if (qBal < c.realQuote) revert TerminalMismatch();
        if (tBal < c.inventory + c.reservedLp) revert TerminalMismatch();
    }

    function _sell(address token, address user, uint256 tokenIn, uint256 minOut, bool exempt, bool sendQuote)
        internal
        returns (uint256 userOut)
    {
        Curve storage c = curves[token];
        if (c.token == address(0) || c.graduated) revert Graduated();
        if (c.ready) revert ReadyLocked();
        if (tokenIn == 0) revert Bad();
        if (minOut == 0) revert MinOutRequired();
        IERC20MinimalExt(token).transferFrom(user, address(this), tokenIn);
        (uint256 quoteOut, uint256 nq, uint256 nt) = CurveMath.sellOut(c.virtualQuote, c.virtualToken, tokenIn);
        if (quoteOut == 0 || quoteOut > c.realQuote) revert Slippage();
        uint256 fee;
        userOut = quoteOut;
        if (!exempt) {
            (uint256 bucket2, uint256 fly, uint256 coreAmt, uint256 f) = FeeMath.split(quoteOut);
            fee = f;
            userOut = quoteOut - fee;
            _payFees(c, bucket2, fly, coreAmt);
        }
        if (userOut < minOut) revert Slippage();
        c.virtualQuote = nq;
        c.virtualToken = nt;
        c.inventory += tokenIn;
        c.realQuote -= quoteOut;
        if (sendQuote) IERC20MinimalExt(c.quote).transfer(user, userOut);
        emit CurveSell(token, user, tokenIn, userOut, fee);
        emit BondingProgress(token, c.realQuote, c.gradTarget, c.inventory);
    }

    function _payFees(Curve storage c, uint256 bucket2, uint256 fly, uint256 coreAmt) internal {
        if (bucket2 > 0) {
            if (c.rewardsMode && ReactorToken(c.token).eligibleSupply() > 0) {
                factory.creditTokenRewards(c.token, bucket2);
                IERC20MinimalExt(c.quote).transfer(c.token, bucket2);
            } else {
                IERC20MinimalExt(c.quote).transfer(address(selfBurn), bucket2);
                selfBurn.accrue(c.token, c.quote, bucket2);
            }
        }
        if (fly > 0 && address(hook.flywheelVault()) != address(0)) {
            IERC20MinimalExt(c.quote).transfer(address(hook.flywheelVault()), fly);
            hook.flywheelVault().accrue(c.quote, fly);
        }
        if (coreAmt > 0 && address(hook.buybackVault()) != address(0)) {
            IERC20MinimalExt(c.quote).transfer(address(hook.buybackVault()), coreAmt);
            hook.buybackVault().accrue(c.quote, coreAmt);
        }
    }

    function _v4Buy(Curve storage c, uint256 quoteIn, uint256 minOut, address recipient)
        internal
        returns (uint256 out)
    {
        PoolKey memory key = _officialKey(c.token, c.quote);
        IERC20MinimalExt(c.quote).approve(address(router), quoteIn);
        out = router.swap(key, c.quote < c.token, -int256(quoteIn), minOut, recipient);
        IERC20MinimalExt(c.quote).approve(address(router), 0);
    }

    function _v4Sell(Curve storage c, uint256 tokenIn, uint256 minOut, address user, address recipient)
        internal
        returns (uint256 out)
    {
        IERC20MinimalExt(c.token).transferFrom(user, address(this), tokenIn);
        PoolKey memory key = _officialKey(c.token, c.quote);
        IERC20MinimalExt(c.token).approve(address(router), tokenIn);
        out = router.swap(key, c.token < c.quote, -int256(tokenIn), minOut, recipient);
        IERC20MinimalExt(c.token).approve(address(router), 0);
    }

    function _officialKey(address token, address quote) internal view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(token < quote ? token : quote),
            currency1: Currency.wrap(token < quote ? quote : token),
            fee: ReactorConstants.LP_FEE,
            tickSpacing: ReactorConstants.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    function _hop(address tokenIn, address tokenOut, uint256 amount) internal returns (uint256) {
        PoolKey memory hop = PoolKey({
            currency0: Currency.wrap(tokenIn < tokenOut ? tokenIn : tokenOut),
            currency1: Currency.wrap(tokenIn < tokenOut ? tokenOut : tokenIn),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        uint256 before = IERC20MinimalExt(tokenOut).balanceOf(address(this));
        IERC20MinimalExt(tokenIn).approve(address(router), amount);
        try router.swap(hop, tokenIn < tokenOut, -int256(amount), 1, address(this)) {}
        catch {
            IERC20MinimalExt(tokenIn).approve(address(router), 0);
            return 0;
        }
        IERC20MinimalExt(tokenIn).approve(address(router), 0);
        return IERC20MinimalExt(tokenOut).balanceOf(address(this)) - before;
    }
}
