// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {Top10Ranker} from "../../src/libraries/Top10Ranker.sol";
import {LaunchAuthorization} from "../../src/libraries/LaunchAuthorization.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

/// @notice Authoritative current-architecture E2E. Replaces obsolete hookless/3%/immediate-v4 demos.
contract CurrentArchitectureTest is Base {
    function test_e2e_current_architecture() public {
        assertEq(auth.guardian(), address(this));
        assertEq(auth.keeper(), keeper);
        assertEq(core.totalSupply(), 1_000_000_000 ether);
        assertEq(core.balanceOf(address(coreVesting)), 100_000_000 ether);
        assertEq(coreVesting.BENEFICIARY(), ReactorConstants.CORE_VESTING_BENEFICIARY);
        assertTrue(registry.isUsdPegOne(address(usdc)));
        assertFalse(registry.isUsdPegOne(address(zec)));
        assertTrue(router.protocolVaultsSealed());
        assertEq(core.balanceOf(address(this)), 0);
        assertEq(core.balanceOf(keeper), 0);

        (uint256 h, uint256 f, uint256 cAmt, uint256 fee) = FeeMath.split(10_000e6);
        assertEq(h, 200e6);
        assertEq(f, 100e6);
        assertEq(cAmt, 50e6);
        assertEq(fee, 350e6);

        address zcat = _instantZcat(1);
        assertTrue(curve.existsOf(zcat));
        assertFalse(curve.graduatedOf(zcat));

        vm.startPrank(bob);
        usdc.approve(address(userRouter), 200e6);
        uint256 nestedOut =
            userRouter.buy(zcat, 200e6, _hop(address(usdc), address(zec), zecUsdcKey), 1, type(uint256).max);
        assertGt(nestedOut, 0);
        vm.stopPrank();

        _fillAndGraduate(alice, zcat);
        assertTrue(curve.graduatedOf(zcat));
        assertTrue(registry.isReactorNative(zcat));
        assertTrue(registry.canLaunch(zcat), "graduated ZCAT is a legal nested quote");

        // Signed nested pricing (ZCAT/ZEC × ZEC/USD). No ZCAT/USDC pool required.
        uint256 vq0 = CurveMath.virtualQuote0(ReactorConstants.DEFAULT_SUPPLY, 18);
        ReactorFactory.InstantParams memory catP = ReactorFactory.InstantParams({
            name: "CAT",
            symbol: "CAT",
            decimals: 18,
            supply: 0,
            quote: zcat,
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
        (LaunchAuthorization.Auth memory priced, bytes memory sig) = _launchAuthIdentity(
            alice, catP, vq0, LaunchAuthorization.INSTANT_CURVE_V1, LaunchAuthorization.MODE_STANDARD
        );

        vm.prank(alice);
        (address cat,) = factory.launchStandard(catP, priced, sig);
        assertEq(ReactorToken(cat).quoteAsset(), zcat, "CAT/ZCAT not CAT/USDC");

        vm.startPrank(bob);
        usdc.approve(address(userRouter), 40e6);
        uint256 catOut = userRouter.buy(
            cat,
            40e6,
            _twoHops(address(usdc), address(zec), zecUsdcKey, zcat, _key(zcat, address(zec))),
            1,
            type(uint256).max
        );
        vm.stopPrank();
        assertGt(catOut, 0);
        assertGt(ReactorToken(cat).balanceOf(bob), 0);
        assertFalse(curve.readyOf(cat), "nested CAT buy must stay on the curve");
        uint256 catFee = selfBurn.accrued(cat) + flywheel.quoteAccrued(zcat) + buyback.accrued(zcat);
        assertGt(catFee, 0, "3.5% of ZCAT notional (2/1/0.5), not 3.5% of USDC in");
        assertApproxEqRel(selfBurn.accrued(cat), (catFee * 200) / 350, 0.01e18, "Standard 2% of 3.5%");
        assertApproxEqRel(flywheel.quoteAccrued(zcat), (catFee * 100) / 350, 0.01e18, "1% flywheel");
        assertApproxEqRel(buyback.accrued(zcat), (catFee * 50) / 350, 0.01e18, "0.5% CORE");
        if (selfBurn.accrued(cat) >= 10_000) {
            vm.prank(keeper);
            uint256 burned = selfBurn.execute(cat, 1);
            assertGt(burned, 1);
        }

        uint256 zecAmt = 2_000e8;
        deal(address(zec), address(flywheel), zecAmt);
        vm.prank(address(hook));
        flywheel.accrue(address(zec), zecAmt);
        uint256 fly0 = flywheel.lifetimeAccrued();
        vm.prank(keeper);
        uint256 settled = flywheel.settleQuote(address(zec), _protocolHop(address(zec), address(usdc), zecUsdcKey), 1);
        assertGt(settled, 1);
        assertEq(flywheel.lifetimeAccrued(), fly0);

        (address usdcTok,) = _instant(
            ReactorFactory.InstantParams({
                name: "TOP",
                symbol: "TOP",
                decimals: 18,
                supply: 0,
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
        _fillAndGraduate(alice, usdcTok);
        usdc.mint(address(flywheel), 5_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 5_000e6);
        _keeperSettle(address(usdc));
        _submitTop10(usdcTok);
        vm.prank(keeper);
        uint256 t10 = flywheel.executeTop10Buyback(usdcTok, _emptyHops(), 1);
        assertGt(t10, 1);

        usdc.mint(address(buyback), 10_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 10_000e6);
        vm.prank(keeper);
        uint256 coreOut = buyback.execute(address(usdc), _emptyHops(), 1);
        assertGt(coreOut, 1);

        vm.prank(bob);
        ReactorToken(zcat).approve(address(userRouter), nestedOut / 4);
        vm.prank(bob);
        uint256 back = userRouter.sell(
            zcat, nestedOut / 4, _hop(address(zec), address(usdc), zecUsdcKey), 1, 1, type(uint256).max
        );
        assertGt(back, 0);

        uint256 catSell = ReactorToken(cat).balanceOf(bob) / 2;
        vm.prank(bob);
        ReactorToken(cat).approve(address(userRouter), catSell);
        vm.prank(bob);
        uint256 catBack = userRouter.sell(
            cat,
            catSell,
            _twoHops(zcat, address(zec), _key(zcat, address(zec)), address(usdc), zecUsdcKey),
            1,
            1,
            type(uint256).max
        );
        assertGt(catBack, 0, "nested CAT sell: minQuoteOut is ZCAT, minFinalOut is USDC");

        address nextKeeper = makeAddr("keeper2");
        auth.setKeeper(nextKeeper);
        assertEq(auth.keeper(), nextKeeper);
        auth.setKeeper(keeper);

        auth.pauseKeeper(true);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.rollEpoch();
        auth.pauseKeeper(false);

        uint256 claimable = ReactorToken(zcat).pendingRewards(alice);
        claimable;
        vm.prank(alice);
        assertTrue(ReactorToken(zcat).transfer(bob, 1 ether));
    }

    function test_e2e_nested_top10_and_ranker() public {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);
        usdc.mint(address(flywheel), 8_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 8_000e6);
        _keeperSettle(address(usdc));
        _submitTop10(zcat);
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](1);
        hops[0] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: address(usdc),
            tokenOut: address(zec),
            minOut: 1,
            data: abi.encode(zecUsdcKey)
        });
        uint256 fly0 = flywheel.lifetimeAccrued();
        vm.prank(keeper);
        uint256 burned = flywheel.executeTop10Buyback(zcat, hops, 1);
        assertGt(burned, 1);
        assertEq(flywheel.lifetimeAccrued(), fly0);

        Top10Ranker.Candidate[] memory arr = new Top10Ranker.Candidate[](1);
        arr[0] = Top10Ranker.cand(address(core), true, true, 9_000_000e6, true);
        (address[] memory t,, bool pause) = Top10Ranker.rank(arr, 250_000e6);
        assertEq(t.length, 0);
        assertFalse(pause);
    }
}
