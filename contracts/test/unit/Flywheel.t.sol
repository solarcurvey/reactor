// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
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

    function test_coreNeverQualifiesTop10() public view {
        (uint256 mcap, bool ok) = oracle.twapMcapUsdc(address(core));
        assertEq(mcap, 0);
        assertFalse(ok);
        assertFalse(oracle.qualifiesTop10(address(core)));
    }

    function test_keeperReserveCannotPullHolderQuote() public {
        address token = _instantZcat(40_000e8);
        _buy(alice, token, address(zec), 1_000e8);
        hook.flush(token);
        uint256 tokenQuote = zec.balanceOf(token);
        uint256 keeperZec = zec.balanceOf(address(keepers));
        assertEq(keeperZec, 0);
        vm.expectRevert();
        keepers.tryPay(keccak256("x"), alice, 0);
        assertEq(zec.balanceOf(token), tokenQuote);
    }

    function test_finalizeBeforeEpochSkips() public {
        uint256 pot = flywheel.usdcPot();
        flywheel.finalizeEpoch();
        assertFalse(flywheel.epochFinalized());
        assertEq(flywheel.usdcPot(), pot);
    }

    function test_zeroEligibleAccumulatesPot() public {
        usdc.mint(address(flywheel), 1_000e6);
        // Force pot via settle of USDC accrued
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 1_000e6);
        flywheel.settleQuote(address(usdc));
        uint256 pot = flywheel.usdcPot();
        assertGt(pot, 0);
        vm.warp(block.timestamp + ReactorConstants.EPOCH_LENGTH + 1);
        flywheel.finalizeEpoch();
        assertTrue(flywheel.epochFinalized());
        assertEq(flywheel.weightSum(), 0);
        assertEq(flywheel.usdcPot(), pot);
    }

    function test_productionFinalizeIdempotent() public {
        vm.warp(block.timestamp + ReactorConstants.EPOCH_LENGTH + 1);
        flywheel.finalizeEpoch();
        assertTrue(flywheel.epochFinalized());
        flywheel.finalizeEpoch();
        assertTrue(flywheel.epochFinalized());
        assertEq(flywheel.weightSum(), 0);
    }
}
