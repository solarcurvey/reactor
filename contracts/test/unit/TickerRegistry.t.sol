// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {Ticker} from "../../src/libraries/Ticker.sol";
import {TickerRegistry} from "../../src/TickerRegistry.sol";
import {LaunchAuthorization} from "../../src/libraries/LaunchAuthorization.sol";
import {ReactorGuardian} from "../../src/ReactorGuardian.sol";

/// @notice §94 ticker registry · §96 factory versioning · §97 permanent lock
contract TickerRegistryTest is Base {
    function test_94_normalize_ascii_upper_alnum() public {
        assertEq(Ticker.normalize("zcat"), "ZCAT");
        assertEq(Ticker.normalize("ZCAT"), "ZCAT");
        assertEq(Ticker.normalize("A1B2"), "A1B2");
        vm.expectRevert(Ticker.BadTicker.selector);
        this.norm("zc at");
        vm.expectRevert(Ticker.BadTicker.selector);
        this.norm("ZC-AT");
        vm.expectRevert(Ticker.BadTicker.selector);
        this.norm("");
        vm.expectRevert(Ticker.BadTicker.selector);
        this.norm("TOOLONG1234"); // 11
        vm.expectRevert(Ticker.BadTicker.selector);
        this.norm(unicode"ZÇAT");
    }

    function norm(string memory s) external pure returns (string memory) {
        return Ticker.normalize(s);
    }

    function test_94_reserved_tickers_cannot_launch() public {
        string[6] memory reserved = ["CORE", "REACTOR", "USDC", "ZEC", "WBTC", "EURC"];
        for (uint256 i; i < reserved.length; i++) {
            ReactorFactory.InstantParams memory p = _usdc(reserved[i]);
            vm.expectRevert(TickerRegistry.TickerUnavailable.selector);
            _instant(p);
        }
    }

    function test_94_successful_launch_locks_24h_global() public {
        (address token,) = _instant(_usdc("MOON"));
        assertEq(factory.tokenTicker(token), "MOON");
        assertEq(factory.tokenFactoryVersion(token), 1);
        assertEq(tickers.tokenFactoryVersion(token), 1);
        (string memory canonical,, bool isAvailable, bool reserved) = tickers.status("moon");
        assertEq(canonical, "MOON");
        assertFalse(isAvailable);
        assertFalse(reserved);

        vm.expectRevert(TickerRegistry.TickerUnavailable.selector);
        _instant(_usdc("moon"));

        vm.warp(block.timestamp + 24 hours - 1);
        vm.expectRevert(TickerRegistry.TickerUnavailable.selector);
        _instant(_usdc("MOON"));

        vm.warp(block.timestamp + 2);
        (address token2,) = _instant(_usdc("MOON"));
        assertTrue(token2 != token);
        assertEq(factory.tokenTicker(token2), "MOON");
    }

    function test_94_failed_auth_does_not_squat() public {
        LaunchAuthorization.Auth memory empty;
        ReactorFactory.InstantParams memory p = _usdc("FREE");
        vm.expectRevert(LaunchAuthorization.BadSigner.selector);
        factory.instantLaunch(p, empty, "");
        (,, bool available,) = tickers.status("FREE");
        assertTrue(available);
        (address token,) = _instant(p);
        assertTrue(token != address(0));
    }

    function test_94_expired_auth_does_not_squat() public {
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _launchAuth("LATE", address(usdc));
        a.deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(factory.authDomain(), a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchAuthorization.Expired.selector);
        factory.instantLaunch(_usdc("LATE"), a, sig);
        assertTrue(tickers.available("LATE"));
    }

    function test_96_factory_version_persisted_and_deprecate_new_only() public {
        (address t1,) = _instant(_usdc("V1A"));
        assertEq(factory.tokenFactoryVersion(t1), 1);
        assertEq(tickers.factoryVersionOf(address(factory)), 1);

        auth.deprecateFactory(address(factory));
        vm.expectRevert(ReactorFactory.FactoryInactive.selector);
        _instant(_usdc("V1B"));

        // Existing V1 token still trades / graduates — deprecate is new-launch only.
        assertTrue(curve.existsOf(t1));
        _buy(alice, t1, address(usdc), 10e6);

        auth.authorizeFactory(address(factory), 1);
        (address t2,) = _instant(_usdc("V1B"));
        assertEq(factory.tokenFactoryVersion(t2), 1);
    }

    function test_96_cannot_reauthorize_different_version() public {
        vm.expectRevert(TickerRegistry.AlreadySet.selector);
        auth.authorizeFactory(address(factory), 2);
    }

    function test_97_permanent_lock_is_one_way() public {
        (address token,) = _instant(_usdc("LOCK"));
        auth.permanentlyLockTicker("LOCK", token);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(TickerRegistry.TickerUnavailable.selector);
        _instant(_usdc("LOCK"));
        vm.expectRevert(TickerRegistry.TickerPermanent.selector);
        auth.permanentlyLockTicker("LOCK", token);
    }

    function test_97_non_guardian_cannot_lock_or_version() public {
        vm.prank(alice);
        vm.expectRevert(TickerRegistry.NotGuardian.selector);
        tickers.permanentlyLockTicker("X", alice);
        vm.prank(alice);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        auth.authorizeFactory(alice, 2);
        vm.prank(alice);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        auth.setLaunchSigner(alice);
    }

    function _usdc(string memory symbol) internal view returns (ReactorFactory.InstantParams memory p) {
        p = ReactorFactory.InstantParams({
            name: symbol,
            symbol: symbol,
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
    }
}
