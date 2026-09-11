// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {LaunchPricing} from "../../src/libraries/LaunchPricing.sol";
import {LaunchAuthorization} from "../../src/libraries/LaunchAuthorization.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {MockERC20} from "../../src/MockERC20.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";

contract LaunchPricingTest is Base {
    function _p() internal view returns (ReactorFactory.InstantParams memory p) {
        p = ReactorFactory.InstantParams({
            name: "Z",
            symbol: "Z",
            decimals: 18,
            supply: 0,
            quote: address(zec),
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
    }

    function test_usdcNeedsLaunchAuth() public {
        LaunchAuthorization.Auth memory empty;
        ReactorFactory.InstantParams memory p = ReactorFactory.InstantParams({
            name: "U",
            symbol: "U",
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
        });
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunch(p, empty, "");
        (address token,) = _instant(p);
        assertTrue(token != address(0));
        assertEq(factory.tokenFactoryVersion(token), 1);
        assertEq(factory.tokenTicker(token), "U");
    }

    function test_nonDollarWithoutSigReverts() public {
        LaunchAuthorization.Auth memory empty;
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunch(_p(), empty, "");
    }

    function test_expiredSigReverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchAuthorization.Expired.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_replaySigReverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        factory.instantLaunchPriced(_p(), a, sig);
        vm.expectRevert();
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_wrongFactoryReverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.factory = alice;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchAuthorization.WrongFactory.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_wrongQuoteReverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.quote = address(btc);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchAuthorization.WrongQuote.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_wrongDecimalsReverts() public {
        (LaunchAuthorization.Auth memory a,) = _priceAuth(address(zec));
        a.quoteDecimals = 6;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        vm.expectRevert(LaunchAuthorization.WrongDecimals.selector);
        factory.instantLaunchPriced(_p(), a, abi.encodePacked(r, s, v));
    }

    function test_zeroVirtualQuoteReverts() public {
        (LaunchAuthorization.Auth memory a,) = _priceAuthVq(address(zec), 0);
        bytes memory sig = _sig(a);
        ReactorFactory.InstantParams memory p = _p();
        vm.expectRevert(ReactorFactory.NeedPricingAuth.selector);
        factory.instantLaunchPriced(p, a, sig);
    }

    function test_tamperedVirtualQuoteReverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.virtualQuote0 = a.virtualQuote0 + 1;
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function _sig(LaunchAuthorization.Auth memory a) internal view returns (bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        sig = abi.encodePacked(r, s, v);
    }

    function test_oldSignerAfterRotationReverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        auth.setLaunchSigner(bob);
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunchPriced(_p(), a, sig);
        auth.setLaunchSigner(pricingSigner);
    }

    function test_wrongCreatorReverts() public {
        (LaunchAuthorization.Auth memory a,) = _priceAuth(address(zec));
        a.creator = alice;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        vm.expectRevert(LaunchAuthorization.WrongCreator.selector);
        factory.instantLaunchPriced(_p(), a, abi.encodePacked(r, s, v));
    }

    function test_zeroAuthIdReverts() public {
        (LaunchAuthorization.Auth memory a,) = _priceAuth(address(zec));
        a.authId = bytes32(0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        vm.expectRevert(LaunchAuthorization.WrongParams.selector);
        factory.instantLaunchPriced(_p(), a, abi.encodePacked(r, s, v));
    }

    function test_quarantinedQuoteReverts() public {
        registry.setEnabled(address(zec), false);
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        vm.expectRevert();
        factory.instantLaunchPriced(_p(), a, sig);
        registry.setEnabled(address(zec), true);
    }

    function test_validSigLaunches() public {
        address token = _instantZcat(1);
        assertTrue(curve.existsOf(token));
    }

    function test_concurrentSameQuoteLaunches() public {
        uint256 vq = CurveMath.virtualQuote0ForUsd(ReactorConstants.DEFAULT_SUPPLY, 8, 50e6);
        (LaunchAuthorization.Auth memory a1, bytes memory s1) =
            _launchAuthFor(address(this), "Z", address(zec), vq, LaunchAuthorization.INSTANT_CURVE_V1);
        (LaunchAuthorization.Auth memory a2, bytes memory s2) =
            _launchAuthFor(address(this), "Z2", address(zec), vq, LaunchAuthorization.INSTANT_CURVE_V1);
        assertTrue(a1.authId != a2.authId);
        (address t1,) = factory.instantLaunchPriced(_p(), a1, s1);
        ReactorFactory.InstantParams memory p2 = _p();
        p2.name = "Z2";
        p2.symbol = "Z2";
        (address t2,) = factory.instantLaunchPriced(p2, a2, s2);
        assertTrue(t1 != t2);
        assertTrue(curve.existsOf(t1) && curve.existsOf(t2));
    }

    function test_eurcStablecoinIsNotUsdPegOne() public {
        MockERC20 eurc = new MockERC20("Euro Coin", "EURC", 6, 0, address(this));
        eurc.mint(alice, 1_000_000e6);
        registry.register(address(eurc), "EURC", "Euro Coin", 6, "", QuoteAssetRegistry.Category.Stablecoins);
        registry.setBuybackRoute(address(eurc), true, true);
        assertFalse(registry.isUsdPegOne(address(eurc)));
        assertTrue(registry.isUsdPegOne(address(usdc)));
        ReactorFactory.InstantParams memory p = _p();
        p.name = "E";
        p.symbol = "E";
        p.quote = address(eurc);
        LaunchAuthorization.Auth memory empty;
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunch(p, empty, "");
        uint256 evq = CurveMath.virtualQuote0ForUsd(ReactorConstants.DEFAULT_SUPPLY, 6, 1_080_000);
        (LaunchAuthorization.Auth memory a, bytes memory sig) =
            _launchAuthFor(address(this), "E", address(eurc), evq, LaunchAuthorization.INSTANT_CURVE_V1);
        (address token,) = factory.instantLaunchPriced(p, a, sig);
        assertTrue(curve.existsOf(token));
    }

    function test_wrongChainReverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        vm.chainId(1);
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_rotatedKeeperDoesNotChangeSigner() public {
        address prev = auth.pricingSigner();
        auth.setKeeper(alice);
        assertEq(auth.pricingSigner(), prev);
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        address token = address(0);
        (token,) = factory.instantLaunchPriced(_p(), a, sig);
        assertTrue(curve.existsOf(token));
        auth.setKeeper(keeper);
    }

    function test_signedVirtualQuote0ControlsCurve() public {
        uint256 custom = 1_234_567_890;
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _priceAuthVq(address(zec), custom);
        (address token,) = factory.instantLaunchPriced(_p(), a, sig);
        assertEq(curve.virtualQuoteOf(token), custom);
        uint256 derived = CurveMath.virtualQuote0(ReactorConstants.DEFAULT_SUPPLY, 8);
        assertTrue(custom != derived);
    }

    function test_usdEquivalentGeometry_usdcZecWbtcNative() public {
        MockERC20 weth = new MockERC20("Wrapped ETH", "WETH", 18, 0, address(this));
        weth.mint(alice, 10_000 ether);
        weth.mint(address(this), 10_000 ether);
        registry.register(address(weth), "WETH", "Wrapped ETH", 18, "", QuoteAssetRegistry.Category.Crypto);
        registry.setBuybackRoute(address(weth), true, true);

        uint256 zecUsd = 50e6;
        uint256 btcUsd = 60_000e6;
        uint256 ethUsd = 3_000e6;

        (address usdcTok,) = _instant(
            ReactorFactory.InstantParams({
                name: "U",
                symbol: "U",
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

        (LaunchAuthorization.Auth memory za, bytes memory zs) = _priceAuthUsd(address(zec), zecUsd);
        (address zTok,) = factory.instantLaunchPriced(_p(), za, zs);

        ReactorFactory.InstantParams memory bp = _p();
        bp.name = "B";
        bp.symbol = "B";
        bp.quote = address(btc);
        (LaunchAuthorization.Auth memory ba, bytes memory bs) = _launchAuthFor(
            address(this),
            "B",
            address(btc),
            CurveMath.virtualQuote0ForUsd(ReactorConstants.DEFAULT_SUPPLY, 8, btcUsd),
            LaunchAuthorization.INSTANT_CURVE_V1
        );
        (address bTok,) = factory.instantLaunchPriced(bp, ba, bs);

        ReactorFactory.InstantParams memory ep = _p();
        ep.name = "E";
        ep.symbol = "E";
        ep.quote = address(weth);
        (LaunchAuthorization.Auth memory ea, bytes memory es) = _launchAuthFor(
            address(this),
            "E",
            address(weth),
            CurveMath.virtualQuote0ForUsd(ReactorConstants.DEFAULT_SUPPLY, 18, ethUsd),
            LaunchAuthorization.INSTANT_CURVE_V1
        );
        (address eTok,) = factory.instantLaunchPriced(ep, ea, es);

        uint256 usdcVq = curve.virtualQuoteOf(usdcTok);
        assertEq(usdcVq, CurveMath.virtualQuote0(ReactorConstants.DEFAULT_SUPPLY, 6));
        assertEq(curve.virtualQuoteOf(zTok), CurveMath.virtualQuote0ForUsd(ReactorConstants.DEFAULT_SUPPLY, 8, zecUsd));
        assertEq(curve.virtualQuoteOf(bTok), CurveMath.virtualQuote0ForUsd(ReactorConstants.DEFAULT_SUPPLY, 8, btcUsd));
        assertEq(curve.virtualQuoteOf(eTok), CurveMath.virtualQuote0ForUsd(ReactorConstants.DEFAULT_SUPPLY, 18, ethUsd));

        // $150 divides evenly at $50 / $60k / $3k so quote-in is an exact USD match.
        uint256 usdcIn = 150e6;
        uint256 zecIn = (usdcIn * 1e8) / zecUsd;
        uint256 btcIn = (usdcIn * 1e8) / btcUsd;
        uint256 ethIn = (usdcIn * 1e18) / ethUsd;
        assertEq(zecIn, 3e8);
        assertEq(btcIn, 250_000);
        assertEq(ethIn, 5e16);

        assertEq(curve.virtualQuoteOf(zTok), (usdcVq * 1e8) / zecUsd);
        assertEq(curve.virtualQuoteOf(bTok), (usdcVq * 1e8) / btcUsd);
        assertEq(curve.virtualQuoteOf(eTok), (usdcVq * 1e18) / ethUsd);

        uint256 uOut = _buy(alice, usdcTok, address(usdc), usdcIn);
        uint256 zOut = _buy(alice, zTok, address(zec), zecIn);
        uint256 bOut = _buy(alice, bTok, address(btc), btcIn);
        uint256 eOut = _buy(alice, eTok, address(weth), ethIn);

        assertApproxEqRel(zOut, uOut, 1e10);
        assertApproxEqRel(bOut, uOut, 1e10);
        assertApproxEqRel(eOut, uOut, 1e10);
    }
}
