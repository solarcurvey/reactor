// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

contract TokenTest is Base {
    function test_noTransferTax() public {
        address token = _instantZcat(50_000e8);
        _buy(alice, token, address(zec), 1_000e8);
        uint256 bal = ReactorToken(token).balanceOf(alice);
        vm.prank(alice);
        ReactorToken(token).transfer(bob, bal);
        assertEq(ReactorToken(token).balanceOf(bob), bal);
        assertEq(ReactorToken(token).balanceOf(alice), 0);
    }

    function test_fixedSupply() public {
        address token = _instantZcat(50_000e8);
        assertEq(ReactorToken(token).totalSupply(), 1_000_000_000 ether);
    }

    function test_unauthorizedCreditReverts() public {
        address token = _instantZcat(50_000e8);
        vm.expectRevert(ReactorToken.NotHook.selector);
        ReactorToken(token).creditRewards(1);
    }

    function test_rewardPersistenceAndNoFutureTheft() public {
        address token = _instantZcat(50_000e8);
        _buy(alice, token, address(zec), 5_000e8);
        uint256 pendingBefore = ReactorToken(token).pendingRewards(alice);
        assertGt(pendingBefore, 0);

        uint256 bal = ReactorToken(token).balanceOf(alice);
        vm.prank(alice);
        ReactorToken(token).transfer(bob, bal);
        assertEq(ReactorToken(token).balanceOf(alice), 0);
        assertApproxEqAbs(ReactorToken(token).pendingRewards(alice), pendingBefore, 1);
        assertLe(ReactorToken(token).pendingRewards(bob), 1);

        _buy(carol, token, address(zec), 2_000e8);
        assertGt(ReactorToken(token).pendingRewards(bob), 0);
        assertEq(ReactorToken(token).pendingRewards(alice), pendingBefore);

        vm.prank(alice);
        uint256 claimed = ReactorToken(token).claimRewards(alice);
        assertEq(claimed, pendingBefore);
        assertEq(ReactorToken(token).pendingRewards(alice), 0);

        vm.prank(alice);
        assertEq(ReactorToken(token).claimRewards(alice), 0);
    }

    function test_poolManagerExcluded() public {
        address token = _instantZcat(50_000e8);
        assertTrue(ReactorToken(token).rewardExcluded(address(pm)));
        assertGt(ReactorToken(token).balanceOf(address(pm)), 0);
        uint256 eligible = ReactorToken(token).eligibleSupply();
        assertEq(eligible, ReactorToken(token).totalSupply() - ReactorToken(token).excludedBalance());
        assertLt(eligible, ReactorToken(token).totalSupply());
    }

    function test_usdcSixDecimalsRawMath() public {
        (address token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "USD Cat",
                symbol: "UCAT",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 10_000e6,
                devBuyQuote: 0,
                image: "",
                description: "usdc quote",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _buy(alice, token, address(usdc), 1_000e6);
        // First-buy rewards sit in leftover until an eligible holder exists, then flush on transfer.
        uint256 pending = ReactorToken(token).pendingRewards(alice);
        uint256 leftover = ReactorToken(token).leftoverRewards();
        assertEq(pending + leftover, 20e6);
        assertEq(buyback.accrued(address(usdc)), 10e6);
    }
}
