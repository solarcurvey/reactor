// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {LaunchPricing} from "../../src/libraries/LaunchPricing.sol";

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

    function test_wrongVirtualQuoteReverts() public {
        (LaunchPricing.Auth memory a,) = _priceAuth(address(zec));
        a.virtualQuote0 = 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        vm.expectRevert(LaunchPricing.WrongParams.selector);
        factory.instantLaunchPriced(_p(), a, abi.encodePacked(r, s, v));
    }

    function test_oldSignerAfterRotationReverts() public {
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(address(zec));
        auth.setPricingSigner(bob);
        vm.expectRevert(LaunchPricing.BadSigner.selector);
        factory.instantLaunchPriced(_p(), a, sig);
        auth.setPricingSigner(pricingSigner);
    }

    function test_wrongNonceReverts() public {
        (LaunchPricing.Auth memory a,) = _priceAuth(address(zec));
        a.nonce = 9;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchPricing.digest(factory.pricingDomain(), a));
        vm.expectRevert(LaunchPricing.Replay.selector);
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
        assertEq(factory.pricingNonce(address(zec)), 1);
    }
}
