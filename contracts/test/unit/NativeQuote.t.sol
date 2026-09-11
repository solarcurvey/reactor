// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";
import {LaunchPricing} from "../../src/libraries/LaunchPricing.sol";

/// @notice Graduated REACTOR tokens become quotes without a per-token Guardian action.
contract NativeQuoteTest is Base {
    function test_nestedQuoteWithoutGuardian() public {
        (address parent,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "PARENT",
                symbol: "PAR",
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
        _fillAndGraduate(alice, parent);
        assertTrue(factory.isGraduatedReactor(parent));
        assertTrue(registry.isReactorNative(parent));
        assertTrue(registry.canLaunch(parent));

        ReactorFactory.InstantParams memory cp = ReactorFactory.InstantParams({
            name: "CHILD",
            symbol: "CHL",
            decimals: 18,
            supply: 0,
            quote: parent,
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "quoted in a graduated REACTOR token",
            website: "",
            twitter: "",
            telegram: ""
        });
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuthFor(alice, parent, factory.expectedVirtualQuote0(parent));
        vm.prank(alice);
        (address child,) = factory.instantLaunchPriced(cp, a, sig);
        assertEq(ReactorToken(child).quoteAsset(), parent);
        _buy(alice, child, parent, ReactorToken(parent).balanceOf(alice) / 10);
        assertGt(curve.realQuoteOf(child), 0);
    }

    function test_guardianCannotInventNativeCategory() public {
        vm.expectRevert();
        registry.register(address(0xBEEF), "FAKE", "FAKE", 18, "", QuoteAssetRegistry.Category.ReactorNative);
    }
}
