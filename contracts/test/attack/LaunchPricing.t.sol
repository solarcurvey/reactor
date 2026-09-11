// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {LaunchPricing} from "../../src/libraries/LaunchPricing.sol";
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

    function test_usdcNeedsNoSig() public {
        (address token,) = factory.instantLaunch(
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
        assertTrue(token != address(0));
    }

    function test_nonDollarWithoutSigReverts() public {
        vm.expectRevert(ReactorFactory.NeedPricingAuth.selector);
        factory.instantLaunch(_p());
    }

    function test_expiredSigReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchPricing.Expired.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_replaySigReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        factory.instantLaunchPriced(_p(), a, sig);
        vm.expectRevert();
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_wrongFactoryReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.factory = alice;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchPricing.WrongFactory.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_wrongQuoteReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.quote = address(btc);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchPricing.WrongQuote.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_wrongDecimalsReverts() public {
        (LaunchPricing.Auth memory a,) = _priceAuth(address(zec));
        a.quoteDecimals = 6;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        vm.expectRevert(LaunchPricing.WrongDecimals.selector);
        factory.instantLaunchPriced(_p(), a, abi.encodePacked(r, s, v));
    }

    function test_zeroVirtualQuoteReverts() public {
        (LaunchPricing.Auth memory a,) = _priceAuthVq(address(zec), 0);
        bytes memory sig = _sig(a);
        ReactorFactory.InstantParams memory p = _p();
        vm.expectRevert(LaunchPricing.WrongParams.selector);
        factory.instantLaunchPriced(p, a, sig);
    }

    function test_tamperedVirtualQuoteReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        a.virtualQuote0 = a.virtualQuote0 + 1;
        vm.expectRevert(LaunchPricing.BadSigner.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function _sig(LaunchPricing.Auth memory a) internal view returns (bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        sig = abi.encodePacked(r, s, v);
    }

    function test_oldSignerAfterRotationReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        auth.setPricingSigner(bob);
        vm.expectRevert(LaunchPricing.BadSigner.selector);
        factory.instantLaunchPriced(_p(), a, sig);
        auth.setPricingSigner(pricingSigner);
    }

    function test_wrongCreatorReverts() public {
        (LaunchPricing.Auth memory a,) = _priceAuth(address(zec));
        a.creator = alice;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        vm.expectRevert(LaunchPricing.WrongCreator.selector);
        factory.instantLaunchPriced(_p(), a, abi.encodePacked(r, s, v));
    }

    function test_zeroSaltReverts() public {
        (LaunchPricing.Auth memory a,) = _priceAuth(address(zec));
        a.salt = bytes32(0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        vm.expectRevert(LaunchPricing.WrongParams.selector);
        factory.instantLaunchPriced(_p(), a, abi.encodePacked(r, s, v));
    }

    function test_quarantinedQuoteReverts() public {
        registry.setEnabled(address(zec), false);
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        vm.expectRevert();
        factory.instantLaunchPriced(_p(), a, sig);
        registry.setEnabled(address(zec), true);
    }

    function test_validSigLaunches() public {
        address token = _instantZcat(1);
        assertTrue(curve.existsOf(token));
    }

    function test_concurrentSameQuoteLaunches() public {
        (LaunchPricing.Auth memory a1, bytes memory s1) = _priceAuthUsd(address(zec), 50e6);
        (LaunchPricing.Auth memory a2, bytes memory s2) = _priceAuthUsd(address(zec), 50e6);
        assertTrue(a1.salt != a2.salt);
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
        vm.expectRevert(ReactorFactory.NeedPricingAuth.selector);
        factory.instantLaunch(p);
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuthUsd(address(eurc), 1_080_000);
        (address token,) = factory.instantLaunchPriced(p, a, sig);
        assertTrue(curve.existsOf(token));
    }

    function test_wrongChainReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        vm.chainId(1);
        vm.expectRevert(LaunchPricing.BadSigner.selector);
        factory.instantLaunchPriced(_p(), a, sig);
    }

    function test_rotatedKeeperDoesNotChangeSigner() public {
        address prev = auth.pricingSigner();
        auth.setKeeper(alice);
        assertEq(auth.pricingSigner(), prev);
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        address token = address(0);
        (token,) = factory.instantLaunchPriced(_p(), a, sig);
        assertTrue(curve.existsOf(token));
        auth.setKeeper(keeper);
    }

    function test_signedVirtualQuote0ControlsCurve() public {
        uint256 custom = 1_234_567_890;
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuthVq(address(zec), custom);
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

        (address usdcTok,) = factory.instantLaunch(
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

        (LaunchPricing.Auth memory za, bytes memory zs) = _priceAuthUsd(address(zec), zecUsd);
        (address zTok,) = factory.instantLaunchPriced(_p(), za, zs);

        ReactorFactory.InstantParams memory bp = _p();
        bp.name = "B";
        bp.symbol = "B";
        bp.quote = address(btc);
        (LaunchPricing.Auth memory ba, bytes memory bs) = _priceAuthUsd(address(btc), btcUsd);
        (address bTok,) = factory.instantLaunchPriced(bp, ba, bs);

        ReactorFactory.InstantParams memory ep = _p();
        ep.name = "E";
        ep.symbol = "E";
        ep.quote = address(weth);
        (LaunchPricing.Auth memory ea, bytes memory es) = _priceAuthUsd(address(weth), ethUsd);
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
