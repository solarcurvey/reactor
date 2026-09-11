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

    /// @notice Uncapped `acc += (dist * 1e27) / S` made `(S * ΣI) / 1e27` exceed
    /// `Σ((S * I) / 1e27)` (observed +78 on 80 credits, +428 on 400). Cap keeps
    /// `sum(pending)+leftover ≤ quote balance` and `≤ lifetime`.
    function test_floorMathSlackIsFewRawUnits() public {
        MockERC20 quote = new MockERC20("Q", "Q", 6, 0, address(this));
        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");

        // Odd supply so `dist * 1e27 / supply` leaves a leftover remainder.
        uint256 supply = 1_000_000 ether + 17;
        ReactorToken token = new ReactorToken(
            "T",
            "T",
            18,
            supply,
            address(quote),
            address(this),
            makeAddr("pm"),
            makeAddr("vault"),
            makeAddr("bb"),
            a,
            false
        );

        vm.prank(a);
        token.transfer(b, 333_333 ether + 5);
        vm.prank(a);
        token.transfer(c, 111_111 ether + 3);

        uint256 maxOverBacking;
        uint256 maxOverLifetime;
        for (uint256 i = 1; i <= 400; i++) {
            uint256 amt = 1 + (i % 97);
            quote.mint(address(token), amt);
            token.creditRewards(amt);

            if (i % 11 == 0) {
                uint256 balA = token.balanceOf(a);
                if (balA > 10) {
                    vm.prank(a);
                    token.transfer(b, (balA * (i % 7 + 1)) / 100);
                }
            }
            if (i % 29 == 0) {
                uint256 pend = token.pendingRewards(b);
                if (pend > 0) {
                    vm.prank(b);
                    token.claimRewards(b);
                }
            }

            uint256 outstanding =
                token.pendingRewards(a) + token.pendingRewards(b) + token.pendingRewards(c) + token.leftoverRewards();
            uint256 backing = quote.balanceOf(address(token));
            uint256 life = token.lifetimeRewards();
            if (outstanding > backing) {
                uint256 gap = outstanding - backing;
                if (gap > maxOverBacking) maxOverBacking = gap;
            }
            if (outstanding > life) {
                uint256 g = outstanding - life;
                if (g > maxOverLifetime) maxOverLifetime = g;
            }
        }

        // Acc-snapshot debt: sum(pending)+leftover ≤ quote balance / lifetime.
        assertEq(maxOverBacking, 0);
        assertEq(maxOverLifetime, 0);
        assertGt(token.lifetimeRewards(), 0);
        uint256 assigned = (token.eligibleSupply() * token.accRewardPerShare()) / 1e27;
        assertLe(assigned + token.leftoverRewards(), token.lifetimeRewards());
    }
}
