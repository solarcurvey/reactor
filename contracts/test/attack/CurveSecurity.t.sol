// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorRouter} from "../../src/ReactorRouter.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice §31 hostile cases: exemption abuse, leftover leak, double graduate.
contract CurveSecurityTest is Base {
    function _p(string memory symbol, address quote)
        internal
        pure
        returns (ReactorFactory.InstantParams memory p)
    {
        p = ReactorFactory.InstantParams({
            name: symbol,
            symbol: symbol,
            decimals: 18,
            supply: 1,
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

    function test_walletCannotSpoofProtocolSwap() public {
        (address token,) = factory.instantLaunch(_p("X", address(usdc)));
        _fillAndGraduate(alice, token);
        PoolKey memory key = _key(token, address(usdc));
        vm.startPrank(alice);
        usdc.approve(address(router), 100e6);
        vm.expectRevert(ReactorRouter.NotVault.selector);
        router.protocolSwap(key, address(usdc) < token, -int256(100e6), 1, alice);
        vm.stopPrank();
    }

    function test_exemptCannotDivertToAttacker() public {
        vm.prank(alice);
        (address token,) = factory.launchStandard(_p("Y", address(usdc)));
        _buy(alice, token, address(usdc), 500e6);
        uint256 acc = selfBurn.accrued(token);
        uint256 aliceTok = ReactorToken(token).balanceOf(alice);
        _keeperSelfBurn(token);
        assertEq(ReactorToken(token).balanceOf(alice), aliceTok);
        assertLe(selfBurn.accrued(token), acc);
        assertEq(ReactorToken(token).balanceOf(address(this)), 0);
    }

    function test_reservedTwentyCannotBeSwept() public {
        (address token,) = factory.instantLaunch(_p("Z", address(usdc)));
        uint256 reserved = curve.reservedOf(token);
        assertEq(reserved, 206_900_000 ether);
        _fillAndGraduate(bob, token);
        assertEq(curve.reservedOf(token), 0);
        assertLt(ReactorToken(token).balanceOf(address(curve)), 1_000 ether);
        uint256 circulating = ReactorToken(token).balanceOf(bob) + ReactorToken(token).balanceOf(alice);
        assertLe(circulating, 793_100_000 ether);
        reserved;
    }
}
