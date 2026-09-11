// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {QuoteMath} from "./libraries/QuoteMath.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";

/// @notice Accrues 0.5% CORE pot (isolated from flywheel). Permissionless execute buys CORE and burns it.
///         Caller cannot set minOut or size. Protocol enforces price safety.
///         Failed executes no-op — they must never revert an upstream user swap.
contract BuybackVault {
    using StateLibrary for IPoolManager;

    address public immutable core;
    address public immutable hook;
    address public immutable usdc;
    IPoolManager public immutable poolManager;
    IReactorSwapper public immutable router;
    QuoteAssetRegistry public immutable registry;
    uint256 public immutable threshold;
    address public immutable configurator;

    PoolKey public corePoolKey;
    bool public coreRouteSet;
    uint160 public coreRefSqrt;
    uint64 public coreRefUpdated;

    mapping(address => PoolKey) public hopPool;
    mapping(address => bool) public hopSet;
    mapping(address => uint160) public hopRefSqrt;

    mapping(address => uint256) public accrued;
    mapping(address => uint64) public lastExecuteAt;
    uint256 public lifetimeAccrued;
    uint256 public lifetimeBurned;
    uint256 public lifetimePurchased;
    uint256 public executeLock;

    enum Safety {
        Ok,
        NoRoute,
        Cooldown,
        BelowThreshold,
        Reserve,
        Deviation,
        Stale,
        Impact
    }

    event BuybackAccrued(address indexed quote, uint256 amount);
    event BuybackExecuted(address indexed quote, uint256 quoteIn, uint256 coreOut, address indexed caller);
    event COREBurned(uint256 amount);
    event CoreRouteConfigured(PoolId poolId);
    event HopRouteConfigured(address indexed quote, PoolId poolId);
    event BuybackSkipped(address indexed quote, Safety reason);

    error NotHook();
    error Reentrant();
    error BadRoute();
    error AlreadySet();

    modifier nonReentrant() {
        if (executeLock == 1) revert Reentrant();
        executeLock = 1;
        _;
        executeLock = 0;
    }

    constructor(
        address core_,
        address hook_,
        address usdc_,
        IPoolManager manager_,
        address router_,
        QuoteAssetRegistry registry_,
        uint256 threshold_
    ) {
        core = core_;
        hook = hook_;
        usdc = usdc_;
        poolManager = manager_;
        router = IReactorSwapper(router_);
        registry = registry_;
        threshold = threshold_;
        configurator = msg.sender;
    }

    function configureCoreRoute(PoolKey calldata key) external {
        if (msg.sender != configurator) revert BadRoute();
        if (coreRouteSet) revert AlreadySet();
        _assertHookless(key);
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool usdcIs0 = c0 == usdc;
        bool usdcIs1 = c1 == usdc;
        bool coreIs0 = c0 == core;
        bool coreIs1 = c1 == core;
        if (!(usdcIs0 || usdcIs1) || !(coreIs0 || coreIs1)) revert BadRoute();
        corePoolKey = key;
        coreRouteSet = true;
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        coreRefSqrt = sqrtP;
        coreRefUpdated = uint64(block.timestamp);
        emit CoreRouteConfigured(key.toId());
    }

    function configureHopRoute(address quote, PoolKey calldata key) external {
        if (msg.sender != configurator) revert BadRoute();
        if (quote == usdc || quote == core) revert BadRoute();
        if (hopSet[quote]) revert AlreadySet();
        _assertHookless(key);
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool q0 = c0 == quote;
        bool q1 = c1 == quote;
        bool u0 = c0 == usdc;
        bool u1 = c1 == usdc;
        if (!(q0 || q1) || !(u0 || u1)) revert BadRoute();
        hopPool[quote] = key;
        hopSet[quote] = true;
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        hopRefSqrt[quote] = sqrtP;
        emit HopRouteConfigured(quote, key.toId());
    }

    function accrue(address quote, uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        if (amount == 0) return;
        accrued[quote] += amount;
        lifetimeAccrued += amount;
        emit BuybackAccrued(quote, amount);
    }

    /// @notice Alias used by keepers / UI. Same as execute.
    function executeCoreBuyback(address quote) external {
        this.execute(quote);
    }

    /// @notice Permissionless. Size and minOut are protocol-computed. Never reverts on price/route failure.
    function execute(address quote) external nonReentrant {
        (uint256 amount, uint256 minCore, Safety s) = preview(quote);
        if (s != Safety.Ok || amount == 0) {
            emit BuybackSkipped(quote, s);
            return;
        }
        accrued[quote] -= amount;
        uint256 usdcIn = quote == usdc ? amount : _hopOrRollback(quote, amount);
        if (usdcIn == 0) return;
        if (quote != usdc) {
            (amount, minCore, s) = preview(usdc);
            if (s != Safety.Ok || amount == 0 || amount > accrued[usdc]) {
                emit BuybackSkipped(usdc, s);
                return;
            }
            accrued[usdc] -= amount;
            usdcIn = amount;
        }
        uint256 coreOut = _swapUsdc(usdcIn, minCore);
        if (coreOut == 0) {
            accrued[usdc] += usdcIn;
            emit BuybackSkipped(quote, Safety.Impact);
            return;
        }
        lastExecuteAt[quote] = uint64(block.timestamp);
        if (quote != usdc) lastExecuteAt[usdc] = uint64(block.timestamp);
        _touchRefs(quote);
        lifetimePurchased += coreOut;
        _burn(coreOut);
        emit BuybackExecuted(quote, usdcIn, coreOut, msg.sender);
    }

    function _hopOrRollback(address quote, uint256 amount) internal returns (uint256 usdcIn) {
        PoolKey memory hop = hopPool[quote];
        uint256 minUsdc = _minOutFor(hop, quote, amount);
        if (minUsdc == 0) {
            accrued[quote] += amount;
            emit BuybackSkipped(quote, Safety.Impact);
            return 0;
        }
        IERC20MinimalExt(quote).approve(address(router), amount);
        try router.swap(hop, Currency.unwrap(hop.currency0) == quote, -int256(amount), minUsdc, address(this)) returns (
            uint256 got
        ) {
            usdcIn = got;
        } catch {
            IERC20MinimalExt(quote).approve(address(router), 0);
            accrued[quote] += amount;
            emit BuybackSkipped(quote, Safety.Impact);
            return 0;
        }
        IERC20MinimalExt(quote).approve(address(router), 0);
        accrued[usdc] += usdcIn;
    }

    function _swapUsdc(uint256 usdcIn, uint256 minCore) internal returns (uint256 coreOut) {
        uint256 before = IERC20MinimalExt(core).balanceOf(address(this));
        IERC20MinimalExt(usdc).approve(address(router), usdcIn);
        try router.swap(
            corePoolKey, Currency.unwrap(corePoolKey.currency0) == usdc, -int256(usdcIn), minCore, address(this)
        ) {}
        catch {
            IERC20MinimalExt(usdc).approve(address(router), 0);
            return 0;
        }
        IERC20MinimalExt(usdc).approve(address(router), 0);
        coreOut = IERC20MinimalExt(core).balanceOf(address(this)) - before;
    }

    function preview(address quote) public view returns (uint256 amount, uint256 minCoreOut, Safety reason) {
        if (!coreRouteSet) return (0, 0, Safety.NoRoute);
        if (!registry.isEnabled(quote)) return (0, 0, Safety.NoRoute);
        if (quote != usdc && !hopSet[quote]) return (0, 0, Safety.NoRoute);
        uint64 last = lastExecuteAt[quote];
        if (last != 0 && block.timestamp < uint256(last) + ReactorConstants.BUYBACK_COOLDOWN) {
            return (0, 0, Safety.Cooldown);
        }

        uint256 avail = accrued[quote];
        uint256 bal = IERC20MinimalExt(quote).balanceOf(address(this));
        if (bal < avail) avail = bal;
        uint256 chunk = (avail * ReactorConstants.BUYBACK_MAX_CHUNK_BPS) / ReactorConstants.BPS_DENOMINATOR;
        uint256 reserve = (avail * ReactorConstants.BUYBACK_MIN_RESERVE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        amount = chunk;
        if (avail < reserve) return (0, 0, Safety.Reserve);
        if (avail - amount < reserve) amount = avail - reserve;
        if (amount < threshold) return (0, 0, Safety.BelowThreshold);

        if (!_priceSafe(quote)) return (0, 0, Safety.Deviation);

        if (quote == usdc) {
            minCoreOut = _minOutFor(corePoolKey, usdc, amount);
        } else {
            uint256 expUsdc = _expectedOut(hopPool[quote], quote, amount);
            uint256 minUsdc = QuoteMath.applyBpsDown(
                expUsdc, ReactorConstants.BPS_DENOMINATOR - ReactorConstants.BUYBACK_MAX_IMPACT_BPS
            );
            minCoreOut = _minOutFor(corePoolKey, usdc, minUsdc);
        }
        if (minCoreOut == 0) return (0, 0, Safety.Impact);
        return (amount, minCoreOut, Safety.Ok);
    }

    function nextEligibleAt(address quote) external view returns (uint64) {
        uint64 last = lastExecuteAt[quote];
        if (last == 0) return 0;
        return last + ReactorConstants.BUYBACK_COOLDOWN;
    }

    function _priceSafe(address quote) internal view returns (bool) {
        if (!_refOk(corePoolKey, coreRefSqrt)) return false;
        if (quote != usdc) {
            if (!_refOk(hopPool[quote], hopRefSqrt[quote])) return false;
        }
        return true;
    }

    function _refOk(PoolKey memory key, uint160 refSqrt) internal view returns (bool) {
        (uint160 spot,,,) = poolManager.getSlot0(key.toId());
        if (refSqrt == 0 || spot == 0) return false;
        // Compare implied 1e18 in → out so decimal-agnostic.
        uint256 refOut = QuoteMath.expectedOut(refSqrt, 1e18, true);
        uint256 spotOut = QuoteMath.expectedOut(spot, 1e18, true);
        uint256 dev = QuoteMath.bpsDiff(refOut, spotOut);
        if (dev > ReactorConstants.BUYBACK_MAX_REF_DEV_BPS) return false;
        return true;
    }

    function _touchRefs(address quote) internal {
        (uint160 coreSpot,,,) = poolManager.getSlot0(corePoolKey.toId());
        if (_refOk(corePoolKey, coreRefSqrt) || coreRefSqrt == 0) {
            coreRefSqrt = coreSpot;
            coreRefUpdated = uint64(block.timestamp);
        }
        if (quote != usdc && hopSet[quote]) {
            (uint160 hopSpot,,,) = poolManager.getSlot0(hopPool[quote].toId());
            hopRefSqrt[quote] = hopSpot;
        }
    }

    function _expectedOut(PoolKey memory key, address tokenIn, uint256 amountIn) internal view returns (uint256) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        bool zfo = Currency.unwrap(key.currency0) == tokenIn;
        return QuoteMath.expectedOut(sqrtP, amountIn, zfo);
    }

    function _minOutFor(PoolKey memory key, address tokenIn, uint256 amountIn) internal view returns (uint256) {
        uint256 exp = _expectedOut(key, tokenIn, amountIn);
        return QuoteMath.applyBpsDown(exp, ReactorConstants.BPS_DENOMINATOR - ReactorConstants.BUYBACK_MAX_IMPACT_BPS);
    }

    function _assertHookless(PoolKey calldata key) internal pure {
        if (address(key.hooks) != address(0)) revert BadRoute();
    }

    function _burn(uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = core.call(abi.encodeWithSignature("burn(uint256)", amount));
        if (!ok) {
            ok = IERC20MinimalExt(core).transfer(ReactorConstants.DEAD, amount);
            require(ok, "BURN");
        }
        lifetimeBurned += amount;
        emit COREBurned(amount);
    }
}
