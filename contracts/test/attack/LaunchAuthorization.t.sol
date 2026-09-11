// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {LaunchAuthorization} from "../../src/libraries/LaunchAuthorization.sol";
import {Ticker} from "../../src/libraries/Ticker.sol";

/// @notice §95 LaunchAuthorization — every launch, including USDC. Unique authId. No serial nonce.
contract LaunchAuthorizationTest is Base {
    function test_95_usdc_requires_auth() public {
        LaunchAuthorization.Auth memory empty;
        ReactorFactory.InstantParams memory p = _p("US1", address(usdc));
        vm.expectRevert(LaunchAuthorization.Expired.selector);
        factory.instantLaunch(p, empty, "");
        empty.deadline = block.timestamp + 15 minutes;
        vm.expectRevert(LaunchAuthorization.WrongFactory.selector);
        factory.instantLaunch(p, empty, "");
        (LaunchAuthorization.Auth memory a,) = _launchAuth("US1", address(usdc));
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunch(p, a, hex"11");
        (address token,) = _instant(p);
        assertEq(factory.tokenTicker(token), "US1");
    }

    function test_95_replay_and_unique_authId() public {
        ReactorFactory.InstantParams memory p = _p("R1", address(usdc));
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _launchAuth("R1", address(usdc));
        factory.instantLaunch(p, a, sig);
        vm.expectRevert();
        factory.instantLaunch(_p("R2", address(usdc)), a, sig);
    }

    function test_95_wrong_ticker_reverts() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _launchAuth("AAA", address(usdc));
        vm.expectRevert(LaunchAuthorization.WrongTicker.selector);
        factory.instantLaunch(_p("BBB", address(usdc)), a, sig);
    }

    function test_95_wrong_factory_reverts() public {
        (LaunchAuthorization.Auth memory a,) = _launchAuth("WF", address(usdc));
        a.factory = alice;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        vm.expectRevert(LaunchAuthorization.WrongFactory.selector);
        factory.instantLaunch(_p("WF", address(usdc)), a, abi.encodePacked(r, s, v));
    }

    function test_95_concurrent_same_quote_no_serial_nonce() public {
        (address t1,) = _instant(_p("C1", address(usdc)));
        (address t2,) = _instant(_p("C2", address(usdc)));
        assertTrue(t1 != t2);
        assertEq(ReactorFactory(address(factory)).tokenTicker(t1), "C1");
    }

    function test_95_launch_signer_not_keeper() public {
        assertTrue(auth.launchSigner() != auth.keeper() || auth.launchSigner() == pricingSigner);
        auth.setKeeper(alice);
        assertEq(auth.launchSigner(), pricingSigner);
        (address token,) = _instant(_p("KS", address(usdc)));
        assertTrue(token != address(0));
        auth.setKeeper(keeper);
    }

    function test_95_fair_requires_auth() public {
        LaunchAuthorization.Auth memory empty;
        ReactorFactory.FairParams memory p = ReactorFactory.FairParams({
            name: "F",
            symbol: "F1",
            decimals: 18,
            supply: 0,
            quote: address(usdc),
            duration: 0,
            auctionBps: 0,
            minRaise: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
        vm.expectRevert(LaunchAuthorization.Expired.selector);
        factory.createFairLaunch(p, empty, "");
        (address token, uint256 id) = _fair(p);
        assertTrue(token != address(0) && id > 0);
        assertEq(factory.tokenFactoryVersion(token), 1);
    }

    function test_95_inactive_factory_cannot_launch() public {
        auth.deprecateFactory(address(factory));
        vm.expectRevert(ReactorFactory.FactoryInactive.selector);
        _instant(_p("XX", address(usdc)));
        auth.authorizeFactory(address(factory), 1);
    }

    function _p(string memory symbol, address quote) internal pure returns (ReactorFactory.InstantParams memory p) {
        p = ReactorFactory.InstantParams({
            name: symbol,
            symbol: symbol,
            decimals: 18,
            supply: 0,
            quote: quote,
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
    }
}
