// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {LegacyRewardMath} from "../../src/libraries/LegacyRewardMath.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {MockERC20} from "../../src/MockERC20.sol";

/// @notice Reproduces over-assignment on the old acc/leftover model when eligible
/// supply shrinks, then proves magnified DPS + corrections never over-assign.
contract RewardSolvencyRegressionTest is Test {
    using LegacyRewardMath for LegacyRewardMath.State;

    LegacyRewardMath.State internal legacy;

    function setUp() public {
        // unused; state is filled per test
    }

    /// @dev This MUST fail on the old model (over-assign after S change + leftover flush).
    function test_legacyOverAssignsWhenEligibleSupplyShrinks() public {
        address a = address(0xA11CE);
        address vault = address(0xB0B);
        uint256 supply = 1_000_000 ether + 17;
        legacy.totalSupply = supply;
        legacy.balanceOf[a] = supply;
        legacy.excluded[vault] = true;

        for (uint256 i = 1; i <= 80; i++) {
            legacy.credit(1 + (i % 97));
        }
        // Shrink eligible supply: most tokens become excluded, leftover re-flushes at tiny S.
        legacy.transfer(a, vault, supply - 1 ether);
        legacy.credit(50);

        uint256 outstanding = legacy.pending(a) + legacy.leftover;
        assertGt(outstanding, legacy.lifetime, "legacy must over-assign (regression lock)");
    }

    function test_newModelNeverOverAssignsSameScenario() public {
        MockERC20 quote = new MockERC20("Q", "Q", 6, 0, address(this));
        address a = makeAddr("a");
        address vault = makeAddr("vault");
        uint256 supply = 1_000_000 ether + 17;
        ReactorToken token = new ReactorToken(
            "T", "T", 18, supply, address(quote), address(this), makeAddr("pm"), vault, address(0), a, false
        );

        for (uint256 i = 1; i <= 80; i++) {
            uint256 amt = 1 + (i % 97);
            quote.mint(address(token), amt);
            token.creditRewards(amt);
        }
        vm.prank(a);
        token.transfer(vault, supply - 1 ether);
        quote.mint(address(token), 50);
        token.creditRewards(50);

        uint256 outstanding = token.pendingRewards(a) + token.leftoverRewards();
        assertLe(outstanding, token.lifetimeRewards());
        assertLe(outstanding, quote.balanceOf(address(token)));
    }

    function test_newModelExactConservationManyCredits() public {
        MockERC20 quote = new MockERC20("Q", "Q", 6, 0, address(this));
        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");
        uint256 supply = 1_000_000 ether + 17;
        ReactorToken token = new ReactorToken(
            "T", "T", 18, supply, address(quote), address(this), makeAddr("pm"), makeAddr("vault"), address(0), a, false
        );
        vm.prank(a);
        token.transfer(b, 333_333 ether + 5);
        vm.prank(a);
        token.transfer(c, 111_111 ether + 3);

        uint256 claimed;
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
            if (i % 29 == 0 && token.pendingRewards(b) > 0) {
                vm.prank(b);
                claimed += token.claimRewards(b);
            }
        }

        uint256 outstanding =
            token.pendingRewards(a) + token.pendingRewards(b) + token.pendingRewards(c) + token.leftoverRewards();
        assertLe(outstanding, quote.balanceOf(address(token)));
        assertLe(outstanding + claimed, token.lifetimeRewards());
        assertEq(token.lifetimeClaimed(), claimed);
    }

    function test_burnReducesSupplyAndAccounting() public {
        MockERC20 quote = new MockERC20("Q", "Q", 6, 0, address(this));
        address a = makeAddr("a");
        ReactorToken token = new ReactorToken(
            "T",
            "T",
            18,
            1_000 ether,
            address(quote),
            address(this),
            makeAddr("pm"),
            makeAddr("v"),
            address(0),
            a,
            false
        );
        quote.mint(address(token), 100);
        token.creditRewards(100);
        vm.prank(a);
        token.burn(200 ether);
        assertEq(token.totalSupply(), 800 ether);
        assertLe(token.pendingRewards(a) + token.leftoverRewards(), quote.balanceOf(address(token)));
    }
}
