// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {InstantCurve} from "../../src/InstantCurve.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";

/// @notice P0-1: ready freezes buys/sells until permissionless graduate; terminal revalidate.
contract CurveFreezeTest is Base {
    function _p(string memory s) internal view returns (ReactorFactory.InstantParams memory p) {
        p = ReactorFactory.InstantParams({
            name: s,
            symbol: s,
            decimals: 18,
            supply: 1,
            quote: address(usdc),
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
    }

    function _fillToReady(address who, address token) internal {
        address quote = _quoteOf(token);
        for (uint256 i; i < 8 && !curve.readyOf(token); i++) {
            uint256 realQuote = curve.realQuoteOf(token);
            uint256 gradTarget = curve.gradTargetOf(token);
            if (realQuote >= gradTarget) break;
            uint256 need = gradTarget - realQuote;
            uint256 userPay = (need * 10_000) / 9_650 + need / 50 + 1;
            _bondToward(who, token, quote, userPay);
        }
        assertTrue(curve.readyOf(token));
        assertFalse(curve.graduatedOf(token));
    }

    function test_exploit_buyToThreshold_ready_sellMustRevert_thenGraduate() public {
        (address token,) = factory.instantLaunch(_p("RDY"));
        _fillToReady(alice, token);

        uint256 bal = ReactorToken(token).balanceOf(alice);
        assertGt(bal, 0);
        vm.startPrank(alice);
        ReactorToken(token).approve(address(curve), bal);
        vm.expectRevert(InstantCurve.ReadyLocked.selector);
        curve.sell(token, bal, 1);
        usdc.approve(address(curve), 1e6);
        vm.expectRevert(InstantCurve.ReadyLocked.selector);
        curve.buy(token, 1e6, 1);
        vm.stopPrank();

        uint256 realQ = curve.realQuoteOf(token);
        uint256 reserved = curve.reservedOf(token);
        uint256 inv = curve.inventoryOf(token);
        uint256 qBal = usdc.balanceOf(address(curve));
        uint256 tBal = ReactorToken(token).balanceOf(address(curve));
        assertGe(realQ, curve.gradTargetOf(token));
        assertGe(qBal, realQ);
        assertGe(tBal, inv + reserved);

        curve.graduate(token);
        assertTrue(curve.graduatedOf(token));
        assertEq(curve.reservedOf(token), 0);
        assertEq(curve.realQuoteOf(token), 0);
        assertEq(ReactorToken(token).balanceOf(address(curve)), inv);
        (,,,,, bool live,) = factory.tokenInfo(token);
        assertTrue(live);
    }

    function test_oneBeforeReady_sellOk() public {
        (address token,) = factory.instantLaunch(_p("PRE"));
        uint256 target = curve.gradTargetOf(token);
        uint256 userPay = (target * 8_000) / 9_650;
        _bondToward(alice, token, address(usdc), userPay);
        assertFalse(curve.readyOf(token));
        uint256 bal = ReactorToken(token).balanceOf(alice);
        assertGt(bal, 0);
        _sell(alice, token, address(usdc), bal / 2);
        assertFalse(curve.readyOf(token));
        vm.expectRevert(InstantCurve.NotReady.selector);
        curve.graduate(token);
    }

    function test_exactTerminalBuyFreezes() public {
        (address token,) = factory.instantLaunch(_p("EX"));
        uint256 target = curve.gradTargetOf(token);
        uint256 userPay = FeeMath.maxGrossForNet(target) + 10;
        vm.prank(alice);
        usdc.approve(address(curve), userPay);
        vm.prank(alice);
        curve.buy(token, userPay, 1);
        assertTrue(curve.readyOf(token));
        assertGe(curve.realQuoteOf(token), target);
        vm.prank(alice);
        usdc.approve(address(curve), 1e6);
        vm.prank(alice);
        vm.expectRevert(InstantCurve.ReadyLocked.selector);
        curve.buy(token, 1e6, 1);
    }

    function test_oversizedTerminalRefundsUnearnedFee() public {
        (address token,) = factory.instantLaunch(_p("OV"));
        uint256 before = usdc.balanceOf(alice);
        uint256 pay = 100_000e6;
        vm.prank(alice);
        usdc.approve(address(curve), pay);
        vm.prank(alice);
        curve.buy(token, pay, 1);
        uint256 spent = before - usdc.balanceOf(alice);
        assertTrue(curve.readyOf(token));
        assertLt(spent, 20_000e6);
        assertGt(spent, 14_000e6);
        uint256 feePots = flywheel.quoteAccrued(address(usdc)) + buyback.accrued(address(usdc))
            + ReactorToken(token).lifetimeRewards();
        assertLt(feePots, 700e6);
        (,,, uint256 fullFeeIfUnclipped) = FeeMath.split(pay);
        assertLt(feePots, fullFeeIfUnclipped / 5);
        assertEq(usdc.balanceOf(address(curve)), curve.realQuoteOf(token));
    }

    function test_repeatGraduateReverts() public {
        (address token,) = factory.instantLaunch(_p("RP"));
        _fillToReady(alice, token);
        curve.graduate(token);
        vm.expectRevert();
        curve.graduate(token);
    }

    function test_sellBeforeReadyOk_afterReadyReverts() public {
        (address token,) = factory.instantLaunch(_p("SL"));
        _buy(alice, token, address(usdc), 1_000e6);
        assertFalse(curve.readyOf(token));
        uint256 half = ReactorToken(token).balanceOf(alice) / 2;
        _sell(alice, token, address(usdc), half);

        (address token2,) = factory.instantLaunch(_p("SL2"));
        _fillToReady(bob, token2);
        uint256 bobTok = ReactorToken(token2).balanceOf(bob);
        vm.startPrank(bob);
        ReactorToken(token2).approve(address(curve), bobTok);
        vm.expectRevert(InstantCurve.ReadyLocked.selector);
        curve.sell(token2, bobTok, 1);
        vm.stopPrank();
    }

    function test_noStrandedInventoryOrQuote() public {
        (address token,) = factory.instantLaunch(_p("ST"));
        uint256 pay = 80_000e6;
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        usdc.approve(address(curve), pay);
        vm.prank(alice);
        curve.buy(token, pay, 1);
        assertTrue(curve.readyOf(token));
        uint256 leftoverQuote = usdc.balanceOf(address(curve)) - curve.realQuoteOf(token);
        assertEq(leftoverQuote, 0);
        uint256 refunded = usdc.balanceOf(alice) - (aliceBefore - pay);
        assertGt(refunded, 50_000e6);
        uint256 inv = curve.inventoryOf(token);
        uint256 reserved = curve.reservedOf(token);
        curve.graduate(token);
        assertEq(ReactorToken(token).balanceOf(address(curve)), inv);
        assertEq(curve.reservedOf(token), 0);
        reserved;
    }

    function test_sellThenRefillReachesReadyAndGraduate() public {
        (address token,) = factory.instantLaunch(_p("RF"));
        _buy(alice, token, address(usdc), 1_000e6);
        _sell(alice, token, address(usdc), ReactorToken(token).balanceOf(alice) / 2);
        _fillToReady(bob, token);
        curve.graduate(token);
        assertTrue(curve.graduatedOf(token));
    }

    function test_graduateRequiresReady() public {
        (address token,) = factory.instantLaunch(_p("NR"));
        _buy(alice, token, address(usdc), 100e6);
        vm.expectRevert(InstantCurve.NotReady.selector);
        curve.graduate(token);
    }
}
