// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";

/// @notice End-to-end Keeper-submitted Top-10 buy+burn and CORE execute with real supply drops.
contract Top10E2ETest is Base {
    function _instantUsdc(string memory name, string memory symbol) internal returns (address token) {
        (token,) = _instant(
            ReactorFactory.InstantParams({
                name: name,
                symbol: symbol,
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 25_000e6,
                devBuyQuote: 0,
                image: "",
                description: "e2e",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function test_submitAndExecuteTop10BurnsSupply() public {
        address token = _instantUsdc("BURN", "BURN");
        _fillAndGraduate(alice, token);
        usdc.mint(address(flywheel), 20_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 20_000e6);
        _keeperSettle(address(usdc));
        assertGt(flywheel.usdcPot(), 0);

        _submitTop10(token);
        assertTrue(flywheel.epochFinalized());
        assertEq(flywheel.ranked(0), token);

        uint256 supplyBefore = ReactorToken(token).totalSupply();
        uint256 potBefore = flywheel.usdcPot();
        vm.prank(keeper);
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
        assertTrue(flywheel.bought(flywheel.epoch(), token));
        assertLt(flywheel.usdcPot(), potBefore);
        assertLt(ReactorToken(token).totalSupply(), supplyBefore, "Top-10 buy must burn");
    }

    function test_twoQualifiersSplitPotThenBurns() public {
        address a = _instantUsdc("TOPA", "TOPA");
        address b = _instantUsdc("TOPB", "TOPB");
        _fillAndGraduate(alice, a);
        _fillAndGraduate(alice, b);

        usdc.mint(address(flywheel), 14_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 14_000e6);
        _keeperSettle(address(usdc));
        uint256 pot = flywheel.usdcPot();

        address[] memory t = new address[](2);
        uint256[] memory w = new uint256[](2);
        t[0] = a;
        t[1] = b;
        w[0] = 6_000;
        w[1] = 4_000;
        vm.prank(keeper);
        flywheel.submitEpoch(0, t, w);

        uint256 sa = ReactorToken(a).totalSupply();
        uint256 sb = ReactorToken(b).totalSupply();
        vm.startPrank(keeper);
        flywheel.executeTop10Buyback(a, _emptyHops(), 1);
        flywheel.executeTop10Buyback(b, _emptyHops(), 1);
        vm.stopPrank();
        assertLt(ReactorToken(a).totalSupply(), sa);
        assertLt(ReactorToken(b).totalSupply(), sb);
        assertLt(flywheel.usdcPot(), 2);
        assertEq(pot, pot);
    }

    function test_executeCoreBuybackBurnsCoreSupply() public {
        address token = _instantUsdc("COREX", "CRX");
        _buy(alice, token, address(usdc), 5_000e6);
        uint256 acc = buyback.accrued(address(usdc));
        assertGt(acc, 0);
        uint256 coreBefore = core.totalSupply();
        uint256 burnedBefore = buyback.lifetimeBurned();
        _keeperCore(address(usdc));
        assertLt(core.totalSupply(), coreBefore, "CORE supply must decrease");
        assertGt(buyback.lifetimeBurned(), burnedBefore);
        assertLt(buyback.accrued(address(usdc)), acc);
    }

    function test_executeCoreBuybackCooldownNoSecondBurn() public {
        address token = _instantUsdc("COREY", "CRY");
        _buy(alice, token, address(usdc), 5_000e6);
        _keeperCore(address(usdc));
        uint256 coreMid = core.totalSupply();
        uint256 accMid = buyback.accrued(address(usdc));
        vm.prank(keeper);
        vm.expectRevert();
        buyback.executeCoreBuyback(address(usdc), _emptyHops(), 1);
        assertEq(core.totalSupply(), coreMid);
        assertEq(buyback.accrued(address(usdc)), accMid);
    }
}
