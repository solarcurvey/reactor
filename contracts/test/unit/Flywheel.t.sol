// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";

contract FlywheelTest is Base {
    function test_feeSplit35BpsIsolatesPots() public {
        address token = _instantZcat(50_000e8);
        _buy(alice, token, address(zec), 10_000e8);
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(10_000e8);
        assertEq(fee, h + f + c);
        assertEq(h, 200e8);
        assertEq(f, 100e8);
        assertEq(c, 50e8);
        assertEq(flywheel.quoteAccrued(address(zec)), 100e8);
        assertEq(buyback.accrued(address(zec)), 50e8);
        assertEq(flywheel.quoteAccrued(address(zec)) + buyback.accrued(address(zec)), 150e8);
    }

    function test_coreNeverQualifiesTop10() public {
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = address(core);
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_noKeeperReserveExists() public view {
        address token = address(usdc);
        assertEq(usdc.balanceOf(address(flywheel)), 0);
        token;
    }

    function test_strangerCannotSettle() public {
        usdc.mint(address(flywheel), 1_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 1_000e6);
        vm.prank(alice);
        vm.expectRevert();
        flywheel.settleQuote(address(usdc), _emptyHops(), 0);
    }

    function test_zeroEligibleAccumulatesPot() public {
        usdc.mint(address(flywheel), 1_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 1_000e6);
        _keeperSettle(address(usdc));
        uint256 pot = flywheel.usdcPot();
        assertGt(pot, 0);
        address[] memory none = new address[](0);
        uint256[] memory w = new uint256[](0);
        vm.prank(keeper);
        flywheel.submitEpoch(0, none, w);
        assertTrue(flywheel.epochFinalized());
        assertEq(flywheel.weightSum(), 0);
        assertEq(flywheel.usdcPot(), pot);
    }

    function test_submitIdempotentReverts() public {
        address[] memory none = new address[](0);
        uint256[] memory w = new uint256[](0);
        vm.prank(keeper);
        flywheel.submitEpoch(0, none, w);
        assertTrue(flywheel.epochFinalized());
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, none, w);
    }
}
