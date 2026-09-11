// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";

/// @notice §31 USDC hop + fee-bucket isolation + Top-10/CORE after InstantCurve.
contract CurveRoutingTest is Base {
    function _p(string memory symbol, address quote, uint256 dev)
        internal
        pure
        returns (ReactorFactory.InstantParams memory p)
    {
        p = ReactorFactory.InstantParams({
            name: symbol,
            symbol: symbol,
            decimals: 18,
            supply: 0,
            quote: quote,
            fdvQuoteRaw: 0,
            devBuyQuote: dev,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
    }

    function test_devBuyTakesFull35AndIsolatesBuckets() public {
        uint256 pay = 105_600_000;
        vm.startPrank(alice);
        usdc.approve(address(factory), pay);
        factory.launchAndBuy(_p("FEE", address(usdc), pay), true, 1);
        vm.stopPrank();
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(pay);
        assertEq(fee, (pay * 350) / 10_000);
        assertEq(h + f + c, fee);
        assertEq(flywheel.quoteAccrued(address(usdc)), f);
        assertEq(buyback.accrued(address(usdc)), c);
        address tok = factory.allTokens(factory.allTokensLength() - 1);
        assertEq(ReactorToken(tok).lifetimeRewards(), 0);
        assertEq(selfBurn.accrued(tok), h);
        assertEq(flywheel.usdcPot(), 0);
    }

    function test_usdcHopBondingHitsQuoteLegAndMinOut() public {
        address token = _instantZcat(1);
        uint256 real0 = curve.realQuoteOf(token);
        uint256 zecPm0 = zec.balanceOf(address(pm));
        uint256 usdcPm0 = usdc.balanceOf(address(pm));
        uint256 usdcAlice0 = usdc.balanceOf(alice);

        vm.startPrank(alice);
        usdc.approve(address(curve), 200e6);
        vm.expectRevert();
        curve.buyWithUsdc(token, 200e6, type(uint256).max);
        uint256 tokensOut = curve.buyWithUsdc(token, 200e6, 1);
        vm.stopPrank();

        assertGt(tokensOut, 0);
        assertEq(ReactorToken(token).quoteAsset(), address(zec));
        assertGt(ReactorToken(token).balanceOf(alice), 0);
        assertGt(curve.realQuoteOf(token), real0, "economic leg is ZEC on the curve, not USDC");
        assertLt(usdc.balanceOf(alice), usdcAlice0);
        assertTrue(zec.balanceOf(address(pm)) != zecPm0 || usdc.balanceOf(address(pm)) != usdcPm0, "USDC-ZEC hop ran");

        uint256 tok = ReactorToken(token).balanceOf(alice) / 4;
        vm.startPrank(alice);
        ReactorToken(token).approve(address(curve), tok);
        vm.expectRevert();
        curve.sellToUsdc(token, tok, type(uint256).max);
        uint256 usdcOut = curve.sellToUsdc(token, tok, 1);
        vm.stopPrank();
        assertGt(usdcOut, 0);
    }

    function test_usdcHopGraduatedHitsOfficialQuoteLeg() public {
        address token = _instantZcat(1);
        _fillAndGraduate(alice, token);
        assertTrue(curve.graduatedOf(token));
        (,,,,, bool live,) = factory.tokenInfo(token);
        assertTrue(live);

        uint256 zecPm0 = zec.balanceOf(address(pm));
        uint256 usdcPm0 = usdc.balanceOf(address(pm));
        uint256 tok0 = ReactorToken(token).balanceOf(bob);

        vm.startPrank(bob);
        usdc.approve(address(curve), 80e6);
        vm.expectRevert();
        curve.buyWithUsdc(token, 80e6, type(uint256).max);
        uint256 tokensOut = curve.buyWithUsdc(token, 80e6, 1);
        vm.stopPrank();

        assertGt(tokensOut, 0);
        assertGt(ReactorToken(token).balanceOf(bob), tok0);
        assertTrue(zec.balanceOf(address(pm)) != zecPm0 || usdc.balanceOf(address(pm)) != usdcPm0);

        uint256 sellAmt = ReactorToken(token).balanceOf(bob) / 5;
        vm.startPrank(bob);
        ReactorToken(token).approve(address(curve), sellAmt);
        vm.expectRevert();
        curve.sellToUsdc(token, sellAmt, type(uint256).max);
        uint256 usdcOut = curve.sellToUsdc(token, sellAmt, 1);
        vm.stopPrank();
        assertGt(usdcOut, 0);
    }

    function test_usdcQuotedBuyWithUsdcIsDirectQuoteLeg() public {
        (address token,) = factory.instantLaunch(_p("USD", address(usdc), 0));
        uint256 real0 = curve.realQuoteOf(token);
        vm.startPrank(alice);
        usdc.approve(address(curve), 400e6);
        uint256 out = curve.buyWithUsdc(token, 400e6, 1);
        vm.stopPrank();
        assertGt(out, 0);
        assertGt(curve.realQuoteOf(token), real0);
        assertEq(ReactorToken(token).quoteAsset(), address(usdc));
    }

    function test_productionTop10SkipsUngraduatedThenBuysAfterGrad() public {
        (address token,) = factory.instantLaunch(_p("T10", address(usdc), 0));
        _buy(alice, token, address(usdc), 1_000e6);
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
        assertEq(flywheel.ranked(0), address(0), "ungraduated Instant cannot rank");

        _fillAndGraduate(alice, token);
        usdc.mint(address(flywheel), 2_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 2_000e6);
        _keeperSettle(address(usdc));
        assertGt(buyback.accrued(address(usdc)), 0);
        uint256 coreBefore = core.totalSupply();
        _keeperCore(address(usdc));
        assertLt(core.totalSupply(), coreBefore);
    }

    function test_selfBurnDoesNotCreditHolderRewards() public {
        vm.prank(alice);
        (address token,) = factory.launchStandard(_p("SB", address(usdc), 0));
        _buy(bob, token, address(usdc), 800e6);
        assertEq(ReactorToken(token).lifetimeRewards(), 0);
        assertGt(selfBurn.accrued(token), 0);
        assertGt(flywheel.quoteAccrued(address(usdc)), 0);
        assertGt(buyback.accrued(address(usdc)), 0);
        assertEq(selfBurn.accrued(token) + flywheel.quoteAccrued(address(usdc)) + buyback.accrued(address(usdc)), (800e6 * 350) / 10_000);
    }
}
