// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {LaunchAuthorization} from "../../src/libraries/LaunchAuthorization.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";

contract FairCurveConfigTest is Base {
    function test_fair_curve_config_binds_params() public {
        ReactorFactory.FairParams memory p = ReactorFactory.FairParams({
            name: "FCAT",
            symbol: "FCAT",
            decimals: 0,
            supply: 0,
            quote: address(usdc),
            duration: 0,
            auctionBps: 0,
            minRaise: 1e6,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
        (address token,) = _fair(p);
        assertTrue(token != address(0));

        bytes32 expected = LaunchAuthorization.fairCurveConfig(
            ReactorConstants.DEFAULT_SUPPLY,
            ReactorConstants.DEFAULT_DECIMALS,
            ReactorConstants.DEFAULT_FAIR_DURATION,
            ReactorConstants.DEFAULT_AUCTION_BPS,
            1e6
        );
        assertTrue(expected != LaunchAuthorization.FAIR_V1);
        assertTrue(expected != LaunchAuthorization.INSTANT_CURVE_V1);
    }

    function test_fair_wrong_curve_config_reverts() public {
        ReactorFactory.FairParams memory p = ReactorFactory.FairParams({
            name: "BAD",
            symbol: "BADCFG",
            decimals: 18,
            supply: ReactorConstants.DEFAULT_SUPPLY,
            quote: address(usdc),
            duration: ReactorConstants.DEFAULT_FAIR_DURATION,
            auctionBps: ReactorConstants.DEFAULT_AUCTION_BPS,
            minRaise: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
        (LaunchAuthorization.Auth memory a, bytes memory sig) = _launchAuthFair(address(this), p);
        a.curveConfig = LaunchAuthorization.FAIR_V1;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, LaunchAuthorization.digest(launchDomain, a));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(LaunchAuthorization.WrongParams.selector);
        factory.createFairLaunch(p, a, sig);
    }
}
