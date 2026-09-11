// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LaunchMath} from "../../src/libraries/LaunchMath.sol";

/// @notice Exact CORE_LIQUIDITY_DESIGN.md simulation: $100k genesis ticks + buy walk.
contract CoreLiquiditySimTest is Base {
    function test_coreTicksMatchFormula() public view {
        (uint160 sqrtP, int24 tick,,) = _slot0(coreKey);
        assertEq(uint256(sqrtP), uint256(coreLp.sqrtPriceX96()));
        int24 aligned = TickMath.getTickAtSqrtPrice(sqrtP);
        aligned;
        assertTrue(coreLp.tickLower() < coreLp.tickUpper());
        assertEq(coreLp.tickLower() % 60, 0);
        assertEq(coreLp.tickUpper() % 60, 0);
        // Single-sided: CORE is entirely on one side of start tick.
        if (address(core) < address(usdc)) {
            assertGt(coreLp.tickLower(), tick);
        } else {
            assertLt(coreLp.tickUpper(), tick);
        }
    }

    function test_coreFdvStartsNear100k() public view {
        uint160 expected = LaunchMath.sqrtPriceFromFdv(
            address(core), address(usdc), ReactorConstants.DEFAULT_SUPPLY, ReactorConstants.CORE_START_FDV_USDC
        );
        (uint160 sqrtP,,,) = _slot0(coreKey);
        assertEq(uint256(sqrtP), uint256(expected));
        assertEq(uint256(coreLp.sqrtPriceX96()), uint256(expected));
    }

    function test_coreBuyWalksPriceOffGenesis() public {
        uint256[] memory spends = new uint256[](6);
        spends[0] = 1_000e6;
        spends[1] = 5_000e6;
        spends[2] = 20_000e6;
        spends[3] = 50_000e6;
        spends[4] = 200_000e6;
        spends[5] = 1_000_000e6;

        (uint160 sqrt0, int24 tick0,,) = _slot0(coreKey);
        uint256 corePm0 = core.balanceOf(address(pm));

        for (uint256 i; i < spends.length; i++) {
            usdc.mint(alice, spends[i]);
            _buy(alice, address(core), address(usdc), spends[i]);
        }
        (uint160 sqrt1, int24 tick1,,) = _slot0(coreKey);
        assertTrue(sqrt1 != sqrt0);
        assertTrue(tick1 != tick0);
        assertLt(core.balanceOf(address(pm)), corePm0);
        emit log_named_uint("sqrt0", sqrt0);
        emit log_named_uint("sqrt1", sqrt1);
        emit log_named_int("tick0", tick0);
        emit log_named_int("tick1", tick1);
        emit log_named_int("tickLower", coreLp.tickLower());
        emit log_named_int("tickUpper", coreLp.tickUpper());
    }

    function test_vestModelUnchangedByTrades() public {
        usdc.mint(alice, 10_000e6);
        _buy(alice, address(core), address(usdc), 10_000e6);
        assertEq(core.balanceOf(address(coreVesting)), 100_000_000 ether);
        assertEq(coreVesting.BENEFICIARY(), ReactorConstants.CORE_VESTING_BENEFICIARY);
        assertEq(coreVesting.claimable(), 0);
        vm.warp(uint256(coreVesting.t0()) + 30 days);
        assertEq(coreVesting.claimable(), 0);
        vm.warp(uint256(coreVesting.t0()) + 30 days + 30 days);
        assertEq(coreVesting.vested(), 10_000_000 ether);
        assertGt(coreVesting.claimable(), 0);
    }

    function test_burnReducesSupply_top10ExcludesCore() public {
        uint256 s0 = core.totalSupply();
        usdc.mint(address(buyback), 20_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 20_000e6);
        _keeperCore(address(usdc));
        assertLt(core.totalSupply(), s0);

        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = address(core);
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }
}
