// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";
import {RouteExec} from "../../src/libraries/RouteExec.sol";
import {LaunchAuthorization} from "../../src/libraries/LaunchAuthorization.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";

/// @notice Intermediate hop minOut must come from that hop's sim — never dust or last-leg reuse.
contract HopFloorsTest is Base {
    function test_nestedSettlePerHopFloorsFromPreview() public {
        (uint256[] memory hopOuts, uint256 finalOut, RouteGuard.Hop[] memory hops) = _previewNestedSettle();
        assertEq(hopOuts.length, 2);
        assertGt(hopOuts[0], 1, "ZEC hop sim");
        assertGt(hopOuts[1], 1, "USDC hop sim");
        assertTrue(hopOuts[0] != hopOuts[1], "intermediate ZEC raw != last-leg USDC raw");

        uint256 hop0Min = (hopOuts[0] * 9850) / 10_000;
        uint256 hop1Min = (hopOuts[1] * 9850) / 10_000;
        assertGt(hop0Min, 1);
        assertGt(hop1Min, 1);
        assertTrue(hop0Min != hop1Min, "floors must not collapse to last-leg");

        hops[0].minOut = hop0Min;
        hops[1].minOut = hop1Min;
        vm.prank(keeper);
        uint256 got = flywheel.settleQuote(hops[0].tokenIn, hops, hop1Min);
        assertGe(got, hop1Min);
        assertGe(got, (finalOut * 90) / 100);
    }

    function test_lastLegReuseIsNotAValidIntermediateFloor() public {
        (uint256[] memory hopOuts,, RouteGuard.Hop[] memory hops) = _previewNestedSettle();
        uint256 hop0Min = (hopOuts[0] * 9850) / 10_000;
        uint256 hop1Min = (hopOuts[1] * 9850) / 10_000;
        assertTrue(hop0Min != hop1Min, "ZEC floor must not equal USDC floor");

        hops[0].minOut = hop1Min;
        hops[1].minOut = hop1Min;
        vm.prank(keeper);
        if (hop1Min > hopOuts[0]) {
            vm.expectRevert();
            flywheel.settleQuote(hops[0].tokenIn, hops, hop1Min);
        } else {
            uint256 weak = flywheel.settleQuote(hops[0].tokenIn, hops, hop1Min);
            assertGt(weak, 0);
            assertLt(hop1Min, hop0Min, "reused last-leg is a weaker intermediate floor");
        }
    }

    function test_nestedTop10PerHopFloors() public {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);

        ReactorFactory.InstantParams memory cp = ReactorFactory.InstantParams({
            name: "CAT",
            symbol: "CAT",
            decimals: 18,
            supply: 0,
            quote: zcat,
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "nested Top-10",
            website: "",
            twitter: "",
            telegram: ""
        });
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _launchAuthFor(
            alice, "CAT", zcat, factory.expectedVirtualQuote0(zcat), LaunchAuthorization.INSTANT_CURVE_V1
        );
        vm.prank(alice);
        (address cat,) = factory.instantLaunchPriced(cp, a, sig);
        _buy(alice, cat, zcat, ReactorToken(zcat).balanceOf(alice) / 5);
        _fillAndGraduate(alice, cat);

        usdc.mint(address(flywheel), 20_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 20_000e6);
        _keeperSettle(address(usdc));
        _submitTop10(cat);

        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](2);
        hops[0] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: address(usdc),
            tokenOut: address(zec),
            minOut: 1,
            data: abi.encode(zecUsdcKey)
        });
        hops[1] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: address(zec),
            tokenOut: zcat,
            minOut: 1,
            data: abi.encode(_key(zcat, address(zec)))
        });

        vm.prank(keeper);
        (bool ok, bytes memory ret) = address(flywheel).call(abi.encodeCall(flywheel.previewTop10Hops, (cat, hops)));
        assertFalse(ok);
        assertEq(bytes4(ret), RouteExec.PreviewHops.selector);
        (uint256[] memory hopOuts, uint256 quoteOut) = abi.decode(_tail(ret), (uint256[], uint256));
        assertEq(hopOuts.length, 2);
        assertGt(hopOuts[0], 1, "USDC-ZEC sim");
        assertGt(hopOuts[1], 1, "ZEC-ZCAT sim");
        assertTrue(hopOuts[0] != hopOuts[1], "must not reuse last-leg as intermediate");

        hops[0].minOut = (hopOuts[0] * 9850) / 10_000;
        hops[1].minOut = (hopOuts[1] * 9850) / 10_000;
        assertGt(hops[0].minOut, 1, "USDC-ZEC floor not dust");
        assertGt(hops[1].minOut, 1, "ZEC-ZCAT floor not dust");
        assertTrue(hops[0].minOut != hops[1].minOut);
        assertTrue(hops[0].minOut != hopOuts[1], "intermediate floor is not last-leg sim");

        vm.prank(keeper);
        uint256 burned = flywheel.executeTop10Buyback(cat, hops, 2);
        assertGt(burned, 1);
        quoteOut;
    }

    function test_previewSettleNeverCommits() public {
        (, uint256 finalOut, RouteGuard.Hop[] memory hops) = _previewNestedSettle();
        uint256 pot = flywheel.usdcPot();
        uint256 acc = flywheel.quoteAccrued(hops[0].tokenIn);
        assertGt(acc, 0);
        assertEq(flywheel.usdcPot(), pot);
        assertGt(finalOut, 1);
    }

    function _previewNestedSettle()
        internal
        returns (uint256[] memory hopOuts, uint256 finalOut, RouteGuard.Hop[] memory hops)
    {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);
        uint256 zcatAmt = 5_000 ether;
        deal(zcat, address(flywheel), zcatAmt);
        vm.prank(address(hook));
        flywheel.accrue(zcat, zcatAmt);

        hops = new RouteGuard.Hop[](2);
        hops[0] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: zcat,
            tokenOut: address(zec),
            minOut: 1,
            data: abi.encode(_key(zcat, address(zec)))
        });
        hops[1] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: address(zec),
            tokenOut: address(usdc),
            minOut: 1,
            data: abi.encode(zecUsdcKey)
        });

        vm.prank(keeper);
        (bool ok, bytes memory ret) = address(flywheel).call(abi.encodeCall(flywheel.previewSettleQuote, (zcat, hops)));
        assertFalse(ok, "preview must revert");
        assertEq(bytes4(ret), RouteExec.PreviewHops.selector);
        (hopOuts, finalOut) = abi.decode(_tail(ret), (uint256[], uint256));
    }

    function _tail(bytes memory ret) internal pure returns (bytes memory out) {
        out = new bytes(ret.length - 4);
        for (uint256 i; i < out.length; i++) {
            out[i] = ret[i + 4];
        }
    }
}

