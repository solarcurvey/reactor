// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IHooks as IHooksZero} from "v4-core/interfaces/IHooks.sol";

contract LaunchesTest is Base {
    function test_instantMultiWalletBuySellClaim() public {
        address token = _instantZcat(80_000e8);
        _buy(alice, token, address(zec), 3_000e8);
        _buy(bob, token, address(zec), 2_000e8);
        assertGt(ReactorToken(token).balanceOf(alice), 0);
        assertGt(ReactorToken(token).pendingRewards(alice), 0);
        assertGt(buyback.accrued(address(zec)), 0);
        assertGe(IERC20Like(address(zec)).balanceOf(token), ReactorToken(token).lifetimeRewards());
        assertGe(IERC20Like(address(zec)).balanceOf(address(buyback)), buyback.accrued(address(zec)));

        uint256 aliceTok = ReactorToken(token).balanceOf(alice);
        _sell(alice, token, address(zec), aliceTok / 4);
        assertGt(ReactorToken(token).pendingRewards(alice), 0);

        vm.prank(alice);
        ReactorToken(token).transfer(carol, aliceTok / 10);
        _buy(bob, token, address(zec), 500e8);
        assertGt(ReactorToken(token).pendingRewards(carol), 0);

        vm.prank(alice);
        ReactorToken(token).claimRewards(alice);
    }

    function test_fairLaunchZeroFeeThenEconomics() public {
        (address token, uint256 fairId) = factory.createFairLaunch(
            ReactorFactory.FairParams({
                name: "FairCat",
                symbol: "FCAT",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(zec),
                duration: 45 minutes,
                auctionBps: 5_000,
                minRaise: 0,
                image: "",
                description: "fair",
                website: "",
                twitter: "",
                telegram: ""
            })
        );

        uint256 hookZec = IERC20Like(address(zec)).balanceOf(address(hook));
        vm.startPrank(alice);
        zec.approve(address(factory), 1_000e8);
        factory.bid(fairId, 1_000e8);
        vm.stopPrank();
        vm.startPrank(bob);
        zec.approve(address(factory), 2_000e8);
        factory.bid(fairId, 2_000e8);
        vm.stopPrank();

        assertEq(IERC20Like(address(zec)).balanceOf(address(hook)), hookZec);
        assertEq(buyback.accrued(address(zec)), 0);

        vm.warp(block.timestamp + 46 minutes);
        factory.finalizeFairLaunch(fairId);
        (,,,,, bool live,) = factory.tokenInfo(token);
        assertTrue(live);

        vm.prank(alice);
        uint256 got = factory.claimFairTokens(fairId, alice);
        assertGt(got, 0);

        vm.expectRevert();
        factory.finalizeFairLaunch(fairId);

        _buy(carol, token, address(zec), 200e8);
        assertGt(buyback.accrued(address(zec)), 0);
        assertGt(ReactorToken(token).pendingRewards(alice), 0);
    }

    function test_hooklessCoreSwapNoReactorFee() public {
        uint256 before = buyback.lifetimeAccrued();
        usdc.approve(address(router), 1_000e6);
        bool zfo = address(usdc) < address(core);
        router.swap(coreKey, zfo, -int256(1_000e6), 0, address(this));
        assertEq(buyback.lifetimeAccrued(), before);
    }

    function _buy(address who, address token, address quote, uint256 amountIn) internal {
        address c0 = token < quote ? token : quote;
        _approveRouter(who, quote, amountIn);
        vm.prank(who);
        router.swap(_key(token, quote), quote == c0, -int256(amountIn), 0, who);
    }

    function _sell(address who, address token, address quote, uint256 amountIn) internal {
        address c0 = token < quote ? token : quote;
        vm.prank(who);
        ReactorToken(token).approve(address(router), amountIn);
        vm.prank(who);
        router.swap(_key(token, quote), token == c0, -int256(amountIn), 0, who);
    }

    function _key(address token, address quote) internal view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(token < quote ? token : quote),
            currency1: Currency.wrap(token < quote ? quote : token),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }
}