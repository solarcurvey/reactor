// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";

contract FeeInvariantTest is Test {
    function test_split_100() public pure {
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(100);
        assertEq(h, 2);
        assertEq(f, 1);
        assertEq(c, 0);
        assertEq(fee, 3);
    }

    function test_split_1e6() public pure {
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(1_000_000);
        assertEq(h, 20_000);
        assertEq(f, 10_000);
        assertEq(c, 5_000);
        assertEq(fee, 35_000);
    }

    function test_split_dust() public pure {
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(1);
        assertEq(h, 0);
        assertEq(f, 0);
        assertEq(c, 0);
        assertEq(fee, 0);
    }

    function testFuzz_split(uint128 notional) public pure {
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(notional);
        assertEq(fee, h + f + c);
        assertEq(h, (uint256(notional) * 200) / 10_000);
        assertEq(f, (uint256(notional) * 100) / 10_000);
        assertEq(c, (uint256(notional) * 50) / 10_000);
        if (notional >= 100) {
            assertLe(fee * 10_000, uint256(notional) * 350);
        }
    }
}
