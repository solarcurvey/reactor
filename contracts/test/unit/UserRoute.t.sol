// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {UserRouteExecutor} from "../../src/UserRouteExecutor.sol";

contract UserRouteTest is Base {
    function test_userBuySellUsdcOfficialLeg() public {
        (address token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "UR",
                symbol: "UR",
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
        _fillAndGraduate(alice, token);
        vm.startPrank(bob);
        usdc.approve(address(userRouter), 200e6);
        uint256 out = userRouter.buy(token, 200e6, _emptyHops(), 1, block.timestamp + 60);
        assertGt(out, 0);
        ReactorToken(token).approve(address(userRouter), out / 2);
        uint256 usdcOut = userRouter.sell(token, out / 2, _emptyHops(), 1, block.timestamp + 60);
        assertGt(usdcOut, 0);
        vm.stopPrank();
    }

    function test_deadlineReverts() public {
        (address token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "DL",
                symbol: "DL",
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
        _fillAndGraduate(alice, token);
        vm.prank(bob);
        usdc.approve(address(userRouter), 10e6);
        vm.prank(bob);
        vm.expectRevert(UserRouteExecutor.Expired.selector);
        userRouter.buy(token, 10e6, _emptyHops(), 1, block.timestamp - 1);
    }

    function test_minFinalOutReverts() public {
        (address token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "MO",
                symbol: "MO",
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
        _fillAndGraduate(alice, token);
        vm.prank(bob);
        usdc.approve(address(userRouter), 10e6);
        vm.prank(bob);
        vm.expectRevert();
        userRouter.buy(token, 10e6, _emptyHops(), type(uint256).max, block.timestamp + 60);
    }

    function test_cannotMarkUserAsVault() public view {
        assertFalse(router.protocolVault(address(userRouter)));
        assertFalse(router.protocolVault(bob));
    }
}
