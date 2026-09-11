// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {LaunchMath} from "../../src/libraries/LaunchMath.sol";

contract FeeFuzzTest is Test {
    function testFuzz_feeNeverExceeds35Bps(uint256 n) public pure {
        n = bound(n, 0, type(uint128).max);
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(n);
        assertEq(h + f + c, fee);
        assertLe(fee, n);
        if (n >= 100) assertLe(fee * 10_000, n * 350);
    }

    function testFuzz_sqrtPriceBounded(uint128 a1, uint128 a0) public pure {
        a1 = uint128(bound(a1, 1, type(uint128).max));
        a0 = uint128(bound(a0, 1, type(uint128).max));
        uint160 p = LaunchMath.encodeSqrtPriceX96(a1, a0);
        assertGt(p, 0);
    }
}
