// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {RouteGuard} from "./libraries/RouteGuard.sol";
import {RouteExec} from "./libraries/RouteExec.sol";

/// @notice 0.5% CORE pot. Designated Keeper routes quote → CORE via approved adapters, then burns.
contract BuybackVault {
    ReactorGuardian public immutable auth;
    address public immutable core;
    address public immutable hook;
    address public immutable usdc;
    IPoolManager public immutable poolManager;
    IReactorSwapper public immutable router;
    QuoteAssetRegistry public immutable registry;
    uint256 public immutable threshold;
    address public factory;
    address public curve;

    mapping(address => uint256) public accrued;
    mapping(address => uint64) public lastExecuteAt;
    uint256 public lifetimeAccrued;
    uint256 public lifetimeBurned;
    uint256 public lifetimePurchased;
    uint256 public executeLock;

    event BuybackAccrued(address indexed quote, uint256 amount);
    event BuybackExecuted(address indexed quote, uint256 quoteIn, uint256 coreOut, address indexed caller);
    event COREBurned(uint256 amount);

    error NotHook();
    error Reentrant();
    error Bad();
    error AlreadySet();

    modifier nonReentrant() {
        if (executeLock == 1) revert Reentrant();
        executeLock = 1;
        _;
        executeLock = 0;
    }

    modifier onlyKeeper() {
        auth.requireKeeper(msg.sender);
        _;
    }

    constructor(
        ReactorGuardian auth_,
        address core_,
        address hook_,
        address usdc_,
        IPoolManager manager_,
        address router_,
        QuoteAssetRegistry registry_,
        uint256 threshold_
    ) {
        auth = auth_;
        core = core_;
        hook = hook_;
        usdc = usdc_;
        poolManager = manager_;
        router = IReactorSwapper(router_);
        registry = registry_;
        threshold = threshold_;
    }

    function bindFactory(address factory_) external {
        if (factory != address(0) || factory_ == address(0)) revert AlreadySet();
        factory = factory_;
    }

    function setCurve(address curve_) external {
        if (msg.sender != factory) revert NotHook();
        if (curve != address(0) || curve_ == address(0)) revert AlreadySet();
        curve = curve_;
    }

    function accrue(address quote, uint256 amount) external {
        if (msg.sender != hook && msg.sender != curve) revert NotHook();
        if (amount == 0) return;
        accrued[quote] += amount;
        lifetimeAccrued += amount;
        emit BuybackAccrued(quote, amount);
    }

    function executeCoreBuyback(address quote, RouteGuard.Hop[] calldata hops, uint256 minOut) external {
        execute(quote, hops, minOut);
    }

    /// @notice Keeper-only. tokenIn from this bucket; tokenOut must be CORE; then burn.
    function execute(address quote, RouteGuard.Hop[] calldata hops, uint256 minOut) public onlyKeeper nonReentrant {
        if (quote == core) revert Bad();
        if (lastExecuteAt[quote] != 0 && block.timestamp < uint256(lastExecuteAt[quote]) + ReactorConstants.BUYBACK_COOLDOWN) {
            revert Bad();
        }
        uint256 avail = accrued[quote];
        uint256 bal = IERC20MinimalExt(quote).balanceOf(address(this));
        if (bal < avail) avail = bal;
        uint256 chunk = (avail * ReactorConstants.BUYBACK_MAX_CHUNK_BPS) / ReactorConstants.BPS_DENOMINATOR;
        uint256 reserve = (avail * ReactorConstants.BUYBACK_MIN_RESERVE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        uint256 amount = chunk;
        if (avail < reserve) revert Bad();
        if (avail - amount < reserve) amount = avail - reserve;
        if (amount < threshold) revert Bad();

        accrued[quote] -= amount;
        uint256 coreOut = RouteExec.run(auth, hops, quote, core, amount, minOut);
        lastExecuteAt[quote] = uint64(block.timestamp);
        lifetimePurchased += coreOut;
        _burn(coreOut);
        emit BuybackExecuted(quote, amount, coreOut, msg.sender);
    }

    function nextEligibleAt(address quote) external view returns (uint64) {
        uint64 last = lastExecuteAt[quote];
        if (last == 0) return 0;
        return last + ReactorConstants.BUYBACK_COOLDOWN;
    }

    function _burn(uint256 amount) internal {
        if (amount == 0) revert Bad();
        (bool ok,) = core.call(abi.encodeWithSignature("burn(uint256)", amount));
        if (!ok) {
            ok = IERC20MinimalExt(core).transfer(ReactorConstants.DEAD, amount);
            require(ok, "BURN");
        }
        lifetimeBurned += amount;
        emit COREBurned(amount);
    }
}
