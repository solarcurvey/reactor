// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";

interface IReactorSwapper {
    function swap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut);
}

/// @notice Accrues 1% quote; permissionless execute buys CORE on a hookless pool and burns it.
contract BuybackVault {
    address public immutable core;
    address public immutable hook;
    IPoolManager public immutable poolManager;
    IReactorSwapper public immutable router;
    uint256 public immutable threshold;
    address public configurator;

    address public coreQuote;
    PoolKey public corePoolKey;
    bool public routeSet;

    mapping(address => uint256) public accrued;
    uint256 public lifetimeAccrued;
    uint256 public lifetimeBurned;
    uint256 public executeLock;

    event BuybackAccrued(address indexed quote, uint256 amount);
    event BuybackExecuted(address indexed quote, uint256 quoteIn, uint256 coreOut, address indexed caller);
    event COREBurned(uint256 amount);
    event RouteConfigured(address quote, PoolId poolId);

    error NotHook();
    error Reentrant();
    error BelowThreshold();
    error RouteUnset();
    error BadRoute();
    error Slippage();
    error Expired();

    modifier nonReentrant() {
        if (executeLock == 1) revert Reentrant();
        executeLock = 1;
        _;
        executeLock = 0;
    }

    constructor(address core_, address hook_, IPoolManager manager_, address router_, uint256 threshold_) {
        core = core_;
        hook = hook_;
        poolManager = manager_;
        router = IReactorSwapper(router_);
        threshold = threshold_;
        configurator = msg.sender;
    }

    function configureRoute(PoolKey calldata key) external {
        if (msg.sender != configurator) revert BadRoute();
        if (routeSet) revert BadRoute();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (address(key.hooks) != address(0)) revert BadRoute();
        if (key.fee != 0 && key.fee != 3000) {
            // hookless CORE pool may use a standard 0.30% LP fee; never a REACTOR hook
        }
        bool coreIs0 = c0 == core;
        bool coreIs1 = c1 == core;
        if (coreIs0 == coreIs1) revert BadRoute();
        coreQuote = coreIs0 ? c1 : c0;
        corePoolKey = key;
        routeSet = true;
        emit RouteConfigured(coreQuote, key.toId());
    }

    function accrue(address quote, uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        if (amount == 0) return;
        accrued[quote] += amount;
        lifetimeAccrued += amount;
        emit BuybackAccrued(quote, amount);
    }

    /// @notice Swap accrued quote → CORE on the immutable hookless route, then burn.
    function execute(address quote, uint256 amount, uint256 minCoreOut, uint256 deadline) external nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        if (!routeSet) revert RouteUnset();
        if (quote != coreQuote) return; // pending OK if route unsafe
        if (amount < threshold) revert BelowThreshold();
        uint256 avail = accrued[quote];
        if (amount > avail) amount = avail;
        if (amount < threshold) revert BelowThreshold();

        accrued[quote] = avail - amount;

        IERC20MinimalExt(quote).approve(address(router), amount);
        uint256 coreBefore = IERC20MinimalExt(core).balanceOf(address(this));

        bool zeroForOne = Currency.unwrap(corePoolKey.currency0) == quote;
        try router.swap(
            corePoolKey,
            zeroForOne,
            -int256(amount),
            minCoreOut,
            address(this)
        ) {} catch {
            accrued[quote] = avail;
            IERC20MinimalExt(quote).approve(address(router), 0);
            return;
        }

        uint256 coreOut = IERC20MinimalExt(core).balanceOf(address(this)) - coreBefore;
        if (coreOut < minCoreOut) revert Slippage();

        _burn(coreOut);
        emit BuybackExecuted(quote, amount, coreOut, msg.sender);
    }

    function _burn(uint256 amount) internal {
        if (amount == 0) return;
        bool ok = IERC20MinimalExt(core).transfer(address(0x000000000000000000000000000000000000dEaD), amount);
        require(ok, "BURN");
        lifetimeBurned += amount;
        emit COREBurned(amount);
    }
}