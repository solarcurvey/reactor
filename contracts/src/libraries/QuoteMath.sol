// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";

library QuoteMath {
    /// @notice Approximate exact-in output from slot0 sqrtPrice (no liquidity impact).
    function expectedOut(uint160 sqrtPriceX96, uint256 amountIn, bool zeroForOne) internal pure returns (uint256) {
        if (amountIn == 0 || sqrtPriceX96 == 0) return 0;
        uint256 p = uint256(sqrtPriceX96);
        if (zeroForOne) {
            // token1 = token0 * (sqrtP^2 / 2^192)
            return FullMath.mulDiv(amountIn, FullMath.mulDiv(p, p, 1 << 96), 1 << 96);
        }
        return FullMath.mulDiv(amountIn, 1 << 96, FullMath.mulDiv(p, p, 1 << 96));
    }

    function applyBpsDown(uint256 amount, uint16 keepBps) internal pure returns (uint256) {
        return (amount * keepBps) / 10_000;
    }

    function bpsDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == b) return 0;
        uint256 hi = a > b ? a : b;
        uint256 lo = a > b ? b : a;
        if (lo == 0) return type(uint256).max;
        return ((hi - lo) * 10_000) / lo;
    }
}
