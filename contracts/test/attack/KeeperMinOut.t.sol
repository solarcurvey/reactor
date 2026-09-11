// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {SelfBurnVault} from "../../src/SelfBurnVault.sol";
import {BuybackVault} from "../../src/BuybackVault.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";

/// @notice P0-2: maintenance buys require Keeper minTargetOut. Sandwich between quote and exec reverts.
contract KeeperMinOutTest is Base {
    function _std(string memory s) internal returns (address token) {
        vm.prank(alice);
        (token,) = _standard(
            ReactorFactory.InstantParams({
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
            })
        );
    }

    function test_selfBurnMinOutZeroReverts() public {
        address token = _std("SB0");
        _buy(bob, token, address(usdc), 2_000e6);
        vm.prank(keeper);
        vm.expectRevert(SelfBurnVault.MinOutRequired.selector);
        selfBurn.execute(token, 0);
    }

    function test_coreMinOutZeroReverts() public {
        usdc.mint(address(buyback), 1_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 1_000e6);
        vm.prank(keeper);
        vm.expectRevert(BuybackVault.MinOutRequired.selector);
        buyback.execute(address(usdc), _emptyHops(), 0);
    }

    function test_top10MinOutZeroReverts() public {
        address token = _std("T0");
        _fillAndGraduate(bob, token);
        usdc.mint(address(flywheel), 3_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 3_000e6);
        _keeperSettle(address(usdc));
        _submitTop10(token);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.executeTop10Buyback(token, _emptyHops(), 0);
    }

    function test_sandwichSelfBurnCurve_quotedMinOutReverts() public {
        address token = _std("SBC");
        _buy(bob, token, address(usdc), 3_000e6);
        uint256 snap = vm.snapshotState();
        uint256 supply0 = ReactorToken(token).totalSupply();
        vm.prank(keeper);
        selfBurn.execute(token, 1);
        uint256 quoted = supply0 - ReactorToken(token).totalSupply();
        assertGt(quoted, 1);
        vm.revertToState(snap);

        _buy(alice, token, address(usdc), 8_000e6);
        vm.prank(keeper);
        vm.expectRevert();
        selfBurn.execute(token, quoted);
    }

    function test_sandwichSelfBurnV4_quotedMinOutReverts() public {
        address token = _std("SBV");
        _fillAndGraduate(bob, token);
        _buy(carol, token, address(usdc), 800e6);
        hook.flush(token);
        assertGt(selfBurn.accrued(token), 0);

        uint256 snap = vm.snapshotState();
        uint256 supply0 = ReactorToken(token).totalSupply();
        vm.prank(keeper);
        selfBurn.execute(token, 1);
        uint256 quoted = supply0 - ReactorToken(token).totalSupply();
        assertGt(quoted, 1);
        vm.revertToState(snap);

        _buy(alice, token, address(usdc), 2_000e6);
        hook.flush(token);
        vm.prank(keeper);
        vm.expectRevert();
        selfBurn.execute(token, quoted);
    }

    function test_sandwichCore_quotedMinOutReverts() public {
        usdc.mint(address(buyback), 50_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 50_000e6);

        uint256 snap = vm.snapshotState();
        uint256 core0 = core.totalSupply();
        vm.prank(keeper);
        buyback.execute(address(usdc), _emptyHops(), 1);
        uint256 quoted = core0 - core.totalSupply();
        assertGt(quoted, 1);
        vm.revertToState(snap);

        vm.startPrank(alice);
        usdc.approve(address(router), 2_000_000e6);
        router.swap(coreKey, address(usdc) < address(core), -int256(2_000_000e6), 1, alice);
        vm.stopPrank();

        vm.prank(keeper);
        vm.expectRevert();
        buyback.execute(address(usdc), _emptyHops(), quoted);
    }

    function test_sandwichTop10_quotedMinOutReverts() public {
        address token = _std("T10");
        _fillAndGraduate(bob, token);
        usdc.mint(address(flywheel), 5_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 5_000e6);
        _keeperSettle(address(usdc));
        _submitTop10(token);

        uint256 snap = vm.snapshotState();
        uint256 supply0 = ReactorToken(token).totalSupply();
        vm.prank(keeper);
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
        uint256 quoted = supply0 - ReactorToken(token).totalSupply();
        assertGt(quoted, 1);
        vm.revertToState(snap);

        _buy(alice, token, address(usdc), 3_000e6);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.executeTop10Buyback(token, _emptyHops(), quoted);
    }

    function test_intermediateHopMinOutZeroReverts() public {
        vm.prank(address(hook));
        flywheel.accrue(address(zec), 1_000e8);
        zec.mint(address(flywheel), 1_000e8);
        RouteGuard.Hop[] memory hops = _hop(address(zec), address(usdc), zecUsdcKey);
        hops[0].minOut = 0;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), hops, 1);
    }
}
