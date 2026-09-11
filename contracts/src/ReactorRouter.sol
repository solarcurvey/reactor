// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";

/// @notice Unlock-callback router for official (and hookless CORE) swaps.
contract ReactorRouter is IUnlockCallback {
    IPoolManager public immutable poolManager;

    error NotManager();
    error Slippage();
    error ZeroAmount();
    error FlushFailed(bytes data);

    constructor(IPoolManager manager_) {
        poolManager = manager_;
    }

    /// @param amountSpecified negative = exact in, positive = exact out
    function swap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (amountSpecified == 0) revert ZeroAmount();
        bytes memory ret =
            poolManager.unlock(abi.encode(uint8(0), msg.sender, recipient, key, zeroForOne, amountSpecified, minOut, int24(0), int24(0), int256(0)));
        amountOut = abi.decode(ret, (uint256));
        // Flush after unlock so the hook can take ERC-6909 claims as locker.
        _flushHook(key);
    }

    function addLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidityDelta)
        external
        returns (BalanceDelta delta)
    {
        bytes memory ret = poolManager.unlock(
            abi.encode(uint8(1), msg.sender, msg.sender, key, false, int256(0), uint256(0), tickLower, tickUpper, liquidityDelta)
        );
        delta = abi.decode(ret, (BalanceDelta));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotManager();
        (
            uint8 action,
            address payer,
            address recipient,
            PoolKey memory key,
            bool zeroForOne,
            int256 amountSpecified,
            uint256 minOut,
            int24 tickLower,
            int24 tickUpper,
            int256 liquidityDelta
        ) = abi.decode(raw, (uint8, address, address, PoolKey, bool, int256, uint256, int24, int24, int256));

        if (action == 1) {
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: liquidityDelta,
                    salt: bytes32(uint256(uint160(payer)))
                }),
                ""
            );
            _handle(key.currency0, payer, recipient, d.amount0());
            _handle(key.currency1, payer, recipient, d.amount1());
            return abi.encode(d);
        }

        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        _handle(key.currency0, payer, recipient, delta.amount0());
        _handle(key.currency1, payer, recipient, delta.amount1());

        uint256 outAmt;
        if (zeroForOne) {
            if (delta.amount1() < 0) revert Slippage();
            outAmt = uint256(uint128(delta.amount1()));
        } else {
            if (delta.amount0() < 0) revert Slippage();
            outAmt = uint256(uint128(delta.amount0()));
        }
        if (outAmt < minOut) revert Slippage();
        return abi.encode(outAmt);
    }

    function _flushHook(PoolKey memory key) internal {
        address h = address(key.hooks);
        if (h == address(0)) return;
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        (bool ok, bytes memory err) = h.call(abi.encodeWithSignature("flush(address,address)", c0, c1));
        if (!ok) revert FlushFailed(err);
        (ok, err) = h.call(abi.encodeWithSignature("flush(address,address)", c1, c0));
        if (!ok) revert FlushFailed(err);
    }

    function _handle(Currency currency, address payer, address recipient, int128 amount) internal {
        if (amount == 0) return;
        address token = Currency.unwrap(currency);
        if (amount < 0) {
            uint256 owe = uint256(uint128(-amount));
            poolManager.sync(currency);
            IERC20MinimalExt(token).transferFrom(payer, address(poolManager), owe);
            poolManager.settle();
        } else {
            poolManager.take(currency, recipient, uint256(uint128(amount)));
        }
    }
}