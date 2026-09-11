// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {LaunchMath} from "../../src/libraries/LaunchMath.sol";

contract FeeFuzzTest is Test {
    function testFuzz_feeNeverExceeds3Pct(uint256 n) public pure {
        n = bound(n, 0, type(uint128).max);
        (uint256 h, uint256 b, uint256 f) = FeeMath.split(n);
        assertEq(h + b, f);
        assertLe(f, n);
        if (n >= 100) assertLe(f * 10000, n * 300);
    }

    function testFuzz_sqrtPriceBounded(uint128 a1, uint128 a0) public pure {
        a1 = uint128(bound(a1, 1, type(uint128).max));
        a0 = uint128(bound(a0, 1, type(uint128).max));
        uint160 p = LaunchMath.encodeSqrtPriceX96(a1, a0);
        assertGt(p, 0);
    }
}
