// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";

/// @notice Structural Top-10 / Keeper security. Contracts do not verify market caps.
contract Top10SecurityTest is Base {
    function _instantUsdc(string memory symbol) internal returns (address token) {
        (token,) = _instant(
            ReactorFactory.InstantParams({
                name: symbol,
                symbol: symbol,
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 25_000e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function _seedPot(uint256 amt) internal {
        usdc.mint(address(flywheel), amt);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), amt);
        _keeperSettle(address(usdc));
    }

    function test_ungraduatedInstantCannotSubmit() public {
        address token = _instantUsdc("PUMP");
        _buy(alice, token, address(usdc), 1_000e6);
        assertFalse(factory.isGraduatedReactor(token));
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_coreNeverTop10() public {
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = address(core);
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_strangerCannotSubmitOrExecute() public {
        address token = _instantUsdc("ONCE");
        _fillAndGraduate(alice, token);
        _seedPot(5_000e6);
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        vm.prank(alice);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
        vm.prank(keeper);
        flywheel.submitEpoch(0, t, w);
        vm.prank(alice);
        vm.expectRevert();
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
    }

    function test_epochDoubleSubmitReverts() public {
        address token = _instantUsdc("DUP");
        _fillAndGraduate(alice, token);
        _submitTop10(token);
        assertEq(flywheel.ranked(0), token);
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
        assertEq(flywheel.ranked(0), token);
    }

    function test_allocationDoubleExecReverts() public {
        address token = _instantUsdc("ONCE");
        _fillAndGraduate(alice, token);
        _seedPot(5_000e6);
        _submitTop10(token);
        uint256 supply0 = ReactorToken(token).totalSupply();
        vm.prank(keeper);
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
        assertTrue(flywheel.bought(flywheel.epoch(), token));
        uint256 supply1 = ReactorToken(token).totalSupply();
        uint256 pot = flywheel.usdcPot();
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
        assertEq(flywheel.usdcPot(), pot);
        assertEq(ReactorToken(token).totalSupply(), supply1);
        assertLt(supply1, supply0);
    }

    function test_rank11RejectedAtSubmit() public {
        address[11] memory toks;
        address[] memory t = new address[](11);
        uint256[] memory w = new uint256[](11);
        for (uint256 i; i < 11; i++) {
            toks[i] = _instantUsdc(string.concat("T", vm.toString(i)));
            _fillAndGraduate(alice, toks[i]);
            t[i] = toks[i];
            w[i] = i == 10 ? 0 : 1_000;
        }
        w[0] = 1_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_lessThanTenSplitFullPot() public {
        address a = _instantUsdc("AAA");
        address b = _instantUsdc("BBB");
        _fillAndGraduate(alice, a);
        _fillAndGraduate(alice, b);
        _seedPot(7_000e6);
        uint256 pot = flywheel.usdcPot();
        address[] memory t = new address[](2);
        uint256[] memory w = new uint256[](2);
        t[0] = a;
        t[1] = b;
        w[0] = 4_000;
        w[1] = 6_000;
        vm.prank(keeper);
        flywheel.submitEpoch(0, t, w);
        assertEq(flywheel.ranked(2), address(0));
        assertEq(flywheel.weightSum(), 10_000);
        assertEq(flywheel.epochPot(), pot);
        assertLe(pot - ((pot * 4_000) / 10_000 + (pot * 6_000) / 10_000), 1);
    }

    function test_zeroEligibleAccumulates() public {
        _seedPot(2_000e6);
        uint256 pot = flywheel.usdcPot();
        address[] memory none = new address[](0);
        uint256[] memory w = new uint256[](0);
        vm.prank(keeper);
        flywheel.submitEpoch(0, none, w);
        assertTrue(flywheel.epochFinalized());
        assertEq(flywheel.weightSum(), 0);
        assertEq(flywheel.ranked(0), address(0));
        assertEq(flywheel.usdcPot(), pot);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.executeTop10Buyback(address(uint160(0xDEAD)), _emptyHops(), 1);
        assertEq(flywheel.usdcPot(), pot);
    }

    function test_bucketIsolationHolderFlywheelCore() public {
        address token = _instantZcat(40_000e8);
        _buy(alice, token, address(zec), 10_000e8);
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(10_000e8);
        assertEq(fee, 350e8);
        assertEq(h, 200e8);
        assertEq(f, 100e8);
        assertEq(c, 50e8);
        if (curve.graduatedOf(token)) hook.flush(token);
        assertEq(flywheel.quoteAccrued(address(zec)), f);
        assertEq(buyback.accrued(address(zec)), c);
        assertEq(selfBurn.accrued(token), h);
    }

    function test_weightsMustSum100Percent() public {
        address token = _instantUsdc("W");
        _fillAndGraduate(alice, token);
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 9_999;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_duplicateTargetsRevert() public {
        address token = _instantUsdc("DD");
        _fillAndGraduate(alice, token);
        address[] memory t = new address[](2);
        uint256[] memory w = new uint256[](2);
        t[0] = token;
        t[1] = token;
        w[0] = 5_000;
        w[1] = 5_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_unapprovedAdapterRejected() public {
        address token = _instantZcat(1);
        _buy(alice, token, address(zec), 1_000e8);
        RouteGuard.Hop[] memory hops = _hop(address(zec), address(usdc), zecUsdcKey);
        hops[0].adapter = alice;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), hops, 1);
    }
}
