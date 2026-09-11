// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {LaunchMath} from "./libraries/LaunchMath.sol";

/// @notice Permanent owner of official CORE/USDC single-sided LP. No withdraw for anyone.
contract CoreLiquidityVault is IUnlockCallback {
    IPoolManager public immutable poolManager;
    ReactorGuardian public immutable auth;
    IHooks public immutable hook;
    address public immutable core;
    address public immutable usdc;

    bool public locked;
    int24 public tickLower;
    int24 public tickUpper;
    uint160 public sqrtPriceX96;
    uint128 public liquidity;

    event LiquidityLocked(PoolId indexed poolId, int24 tickLower, int24 tickUpper, uint128 liquidity, uint160 sqrtP);

    error NotGuardian();
    error Already();
    error NotManager();
    error WithdrawDisabled();
    error Bad();

    constructor(IPoolManager manager_, ReactorGuardian auth_, IHooks hook_, address core_, address usdc_) {
        if (address(manager_) == address(0) || address(auth_) == address(0) || address(hook_) == address(0)) revert Bad();
        if (core_ == address(0) || usdc_ == address(0) || core_ == usdc_) revert Bad();
        poolManager = manager_;
        auth = auth_;
        hook = hook_;
        core = core_;
        usdc = usdc_;
    }

    function poolKey() public view returns (PoolKey memory key) {
        address a = core < usdc ? core : usdc;
        address b = core < usdc ? usdc : core;
        key = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: ReactorConstants.LP_FEE,
            tickSpacing: ReactorConstants.TICK_SPACING,
            hooks: hook
        });
    }

    /// @notice Guardian once: init official CORE/USDC at ~$100k FDV and lock 900M CORE single-sided.
    function initializeAndLock() external {
        if (msg.sender != auth.guardian()) revert NotGuardian();
        if (locked) revert Already();
        uint256 amt = IERC20MinimalExt(core).balanceOf(address(this));
        if (amt < ReactorConstants.CORE_LP_AMOUNT) revert Bad();

        PoolKey memory key = poolKey();
        uint160 sqrtP = LaunchMath.sqrtPriceFromFdv(core, usdc, ReactorConstants.DEFAULT_SUPPLY, ReactorConstants.CORE_START_FDV_USDC);
        poolManager.initialize(key, sqrtP);
        int24 startTick = TickMath.getTickAtSqrtPrice(sqrtP);
        (int24 lo, int24 hi) = LaunchMath.singleSidedRange(core, usdc, startTick, ReactorConstants.TICK_SPACING);
        uint128 liq = LaunchMath.liquidityForSingleSided(core, usdc, lo, hi, amt);
        if (liq == 0) revert Bad();

        bytes memory ret = poolManager.unlock(abi.encode(key, lo, hi, int256(uint256(liq))));
        BalanceDelta delta = abi.decode(ret, (BalanceDelta));
        delta; // settled in callback

        locked = true;
        tickLower = lo;
        tickUpper = hi;
        sqrtPriceX96 = sqrtP;
        liquidity = liq;
        emit LiquidityLocked(key.toId(), lo, hi, liq, sqrtP);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotManager();
        (PoolKey memory key, int24 lo, int24 hi, int256 liquidityDelta) =
            abi.decode(data, (PoolKey, int24, int24, int256));
        if (liquidityDelta < 0) revert WithdrawDisabled();
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: lo, tickUpper: hi, liquidityDelta: liquidityDelta, salt: bytes32(0)
            }),
            ""
        );
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 amount) internal {
        if (amount == 0) return;
        address token = Currency.unwrap(currency);
        if (amount < 0) {
            uint256 owe = uint256(uint128(-amount));
            poolManager.sync(currency);
            IERC20MinimalExt(token).transfer(address(poolManager), owe);
            poolManager.settle();
        } else {
            poolManager.take(currency, address(this), uint256(uint128(amount)));
        }
    }
}
