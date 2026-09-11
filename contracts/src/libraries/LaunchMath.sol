// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LiquidityAmounts} from "./LiquidityAmounts.sol";

library LaunchMath {
    error InvalidPrice();

    /// @notice sqrt(token1/token0) * 2^96 from raw reserve-style amounts.
    function encodeSqrtPriceX96(uint256 amount1, uint256 amount0) internal pure returns (uint160) {
        if (amount0 == 0 || amount1 == 0) revert InvalidPrice();
        uint256 ratioX128 = FullMath.mulDiv(amount1, 1 << 128, amount0);
        if (ratioX128 == 0) revert InvalidPrice();
        uint256 sqrtX64 = _sqrt(ratioX128);
        uint256 sqrtPriceX96 = sqrtX64 << 32;
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE) return TickMath.MIN_SQRT_PRICE + 1;
        if (sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) return TickMath.MAX_SQRT_PRICE - 1;
        return uint160(sqrtPriceX96);
    }

    /// @notice Starting sqrt price from fully-diluted quote valuation (raw quote units).
    function sqrtPriceFromFdv(address token, address quote, uint256 totalSupply, uint256 fdvQuoteRaw)
        internal
        pure
        returns (uint160)
    {
        if (token < quote) {
            return encodeSqrtPriceX96(fdvQuoteRaw, totalSupply);
        }
        return encodeSqrtPriceX96(totalSupply, fdvQuoteRaw);
    }

    function alignTick(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && (tick % spacing != 0)) compressed -= 1;
        return compressed * spacing;
    }

    /// @notice Single-sided range that holds only `token` given a start tick.
    function singleSidedRange(address token, address quote, int24 startTick, int24 spacing)
        internal
        pure
        returns (int24 tickLower, int24 tickUpper)
    {
        int24 minU = TickMath.minUsableTick(spacing);
        int24 maxU = TickMath.maxUsableTick(spacing);
        int24 aligned = alignTick(startTick, spacing);

        if (token < quote) {
            tickLower = aligned + spacing;
            if (tickLower >= maxU) tickLower = maxU - spacing;
            tickUpper = maxU;
        } else {
            tickUpper = aligned - spacing;
            if (tickUpper <= minU) tickUpper = minU + spacing;
            tickLower = minU;
        }
        if (tickLower >= tickUpper) revert InvalidPrice();
    }

    function liquidityForSingleSided(address token, address quote, int24 tickLower, int24 tickUpper, uint256 amount)
        internal
        pure
        returns (uint128)
    {
        uint160 sa = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sb = TickMath.getSqrtPriceAtTick(tickUpper);
        if (token < quote) {
            return LiquidityAmounts.getLiquidityForAmount0(sa, sb, amount);
        }
        return LiquidityAmounts.getLiquidityForAmount1(sa, sb, amount);
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}