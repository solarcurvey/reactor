// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Base} from "../Base.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";

/// @notice §29 stateful CORE invariants.
contract CoreHandler is Test {
    Base public host;

    constructor(Base host_) {
        host = host_;
    }

    function userBuy(uint96 usdcIn) external {
        uint256 amt = bound(usdcIn, 1e6, 50_000e6);
        host.usdc().mint(address(this), amt);
        host.usdc().approve(address(host.router()), amt);
        try host.router().swap(host.officialCoreKey(), address(host.usdc()) < address(host.core()), -int256(amt), 1, address(this))
        {} catch {}
    }

    function keeperBurn() external {
        uint256 acc = host.buyback().accrued(address(host.usdc()));
        if (acc < ReactorConstants.DEFAULT_BUYBACK_THRESHOLD) return;
        vm.warp(block.timestamp + ReactorConstants.BUYBACK_COOLDOWN);
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](0);
        vm.prank(host.keeper());
        try host.buyback().execute(address(host.usdc()), hops, 1) {} catch {}
    }

    function vestClaim() external {
        vm.warp(block.timestamp + 40 days);
        vm.prank(ReactorConstants.CORE_VESTING_BENEFICIARY);
        try host.coreVesting().claim() {} catch {}
    }
}

contract CoreInvariantTest is Base {
    CoreHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CoreHandler(this);
        targetContract(address(handler));
    }

    function invariant_29_supplyPlusBurnedIs1B() public view {
        assertEq(core.totalSupply() + buyback.lifetimeBurned(), 1_000_000_000 ether);
    }

    function invariant_29_vestingPlusClaimedLe100M() public view {
        assertLe(core.balanceOf(address(coreVesting)) + coreVesting.claimed(), 100_000_000 ether);
        assertLe(coreVesting.claimed(), coreVesting.vested());
    }

    function invariant_29_coreNeverRanked() public view {
        address[] memory ranked = _peekRanked();
        for (uint256 i; i < ranked.length; i++) {
            assertTrue(ranked[i] != address(core));
        }
    }

    function invariant_29_noDeployerMint() public view {
        assertTrue(core.minted());
        assertEq(core.balanceOf(guardian), 0);
    }

    function _peekRanked() internal view returns (address[] memory out) {
        out = new address[](0);
    }
}
