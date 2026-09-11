// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {MockERC20} from "../../src/MockERC20.sol";

contract RewardsInvariantTest is Test {
    function test_solvencyAfterCreditsAndTransfers() public {
        MockERC20 quote = new MockERC20("Q", "Q", 6, 0, address(this));
        address hook = address(this);
        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");

        ReactorToken token = new ReactorToken(
            "T",
            "T",
            18,
            1_000_000 ether,
            address(quote),
            hook,
            makeAddr("pm"),
            makeAddr("vault"),
            makeAddr("bb"),
            a,
            false
        );

        quote.mint(address(token), 1_000e6);
        token.creditRewards(1_000e6);

        vm.prank(a);
        token.transfer(b, 100_000 ether);
        vm.prank(a);
        token.transfer(c, 50_000 ether);

        uint256 outstanding =
            token.pendingRewards(a) + token.pendingRewards(b) + token.pendingRewards(c) + token.leftoverRewards();
        assertLe(outstanding, quote.balanceOf(address(token)));

        vm.prank(a);
        token.claimRewards(a);
        outstanding =
            token.pendingRewards(a) + token.pendingRewards(b) + token.pendingRewards(c) + token.leftoverRewards();
        assertLe(outstanding, quote.balanceOf(address(token)));
    }
}
