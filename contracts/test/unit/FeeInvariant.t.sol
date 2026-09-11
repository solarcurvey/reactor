// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";

contract FeeInvariantTest is Test {
    function test_split_100() public pure {
        (uint256 h, uint256 b, uint256 f) = FeeMath.split(100);
        assertEq(h, 2);
        assertEq(b, 1);
        assertEq(f, 3);
    }

    function test_split_1e6() public pure {
        (uint256 h, uint256 b, uint256 f) = FeeMath.split(1_000_000);
        assertEq(h, 20_000);
        assertEq(b, 10_000);
        assertEq(f, 30_000);
    }

    function test_split_dust() public pure {
        (uint256 h, uint256 b, uint256 f) = FeeMath.split(1);
        assertEq(h, 0);
        assertEq(b, 0);
        assertEq(f, 0);
    }

    function testFuzz_split(uint128 notional) public pure {
        (uint256 h, uint256 b, uint256 f) = FeeMath.split(notional);
        assertEq(f, h + b);
        assertEq(h, (uint256(notional) * 200) / 10_000);
        assertEq(b, (uint256(notional) * 100) / 10_000);
        if (notional >= 100) {
            assertLe(f * 10000, uint256(notional) * 300);
        }
    }
}
