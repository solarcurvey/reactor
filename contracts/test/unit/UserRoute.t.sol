// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {UserRouteExecutor} from "../../src/UserRouteExecutor.sol";

contract UserRouteTest is Base {
    function test_userBuySellUsdcOfficialLeg() public {
        (address token,) = _instant(
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
        uint256 usdcOut = userRouter.sell(token, out / 2, _emptyHops(), 1, 1, block.timestamp + 60);
        assertGt(usdcOut, 0);
        vm.stopPrank();
    }

    function test_deadlineReverts() public {
        (address token,) = _instant(
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
        (address token,) = _instant(
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
        assertTrue(router.protocolVault(address(protocolAdapter)));
        assertTrue(router.protocolVault(address(flywheel)));
    }

    function test_userBuySellUsdcWhileBonding() public {
        (address token,) = _instant(
            ReactorFactory.InstantParams({
                name: "BD",
                symbol: "BD",
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
        assertFalse(curve.graduatedOf(token));
        assertFalse(curve.readyOf(token));

        vm.startPrank(bob);
        usdc.approve(address(userRouter), 200e6);
        uint256 out = userRouter.buy(token, 200e6, _emptyHops(), 1, block.timestamp + 60);
        assertGt(out, 0);
        assertFalse(curve.graduatedOf(token));
        ReactorToken(token).approve(address(userRouter), out / 2);
        uint256 usdcOut = userRouter.sell(token, out / 2, _emptyHops(), 1, 1, block.timestamp + 60);
        assertGt(usdcOut, 0);
        vm.stopPrank();
    }

    function test_userBuyUsdcNestedWhileBonding() public {
        address token = _instantZcat(1);
        assertFalse(curve.graduatedOf(token));

        vm.startPrank(bob);
        usdc.approve(address(userRouter), 200e6);
        uint256 out =
            userRouter.buy(token, 200e6, _hop(address(usdc), address(zec), zecUsdcKey), 1, block.timestamp + 60);
        assertGt(out, 0);
        ReactorToken(token).approve(address(userRouter), out / 2);
        uint256 usdcOut =
            userRouter.sell(token, out / 2, _hop(address(zec), address(usdc), zecUsdcKey), 1, 1, block.timestamp + 60);
        assertGt(usdcOut, 0);
        vm.stopPrank();
    }

    function test_nestedSellSeparateMins_usdc6_token18_zec8() public {
        address zcat = _instantZcat(1);
        vm.startPrank(bob);
        usdc.approve(address(userRouter), 300e6);
        uint256 out =
            userRouter.buy(zcat, 300e6, _hop(address(usdc), address(zec), zecUsdcKey), 1, block.timestamp + 60);
        ReactorToken(zcat).approve(address(userRouter), out);
        // 1000e8 is 1000 ZEC. A ~$300 USDC buy cannot clear that as the first-leg ZEC floor.
        // Reusing a USDC-6 min (e.g. 10e6) as minQuoteOut would be a different unit.
        uint256 snap = vm.snapshotState();
        vm.expectRevert();
        userRouter.sell(zcat, out, _hop(address(zec), address(usdc), zecUsdcKey), 1_000e8, 1, block.timestamp + 60);
        vm.revertToState(snap);
        uint256 usdcOut =
            userRouter.sell(zcat, out / 2, _hop(address(zec), address(usdc), zecUsdcKey), 1, 1, block.timestamp + 60);
        assertGt(usdcOut, 0);
        vm.stopPrank();
    }

    function test_sellMinQuoteOutZeroReverts() public {
        (address token,) = _instant(
            ReactorFactory.InstantParams({
                name: "ZQ",
                symbol: "ZQ",
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
        usdc.approve(address(userRouter), 50e6);
        uint256 out = userRouter.buy(token, 50e6, _emptyHops(), 1, block.timestamp + 60);
        ReactorToken(token).approve(address(userRouter), out);
        vm.expectRevert(UserRouteExecutor.MinOutRequired.selector);
        userRouter.sell(token, out, _emptyHops(), 0, 1, block.timestamp + 60);
        vm.stopPrank();
    }

    function test_sellSandwichOnOfficialPoolReverts() public {
        (address token,) = _instant(
            ReactorFactory.InstantParams({
                name: "SW",
                symbol: "SW",
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
        uint256 bought = userRouter.buy(token, 200e6, _emptyHops(), 1, block.timestamp + 60);
        vm.stopPrank();

        uint256 snap = vm.snapshotState();
        vm.startPrank(bob);
        ReactorToken(token).approve(address(userRouter), bought);
        uint256 honest = userRouter.sell(token, bought, _emptyHops(), 1, 1, block.timestamp + 60);
        vm.stopPrank();
        vm.revertToState(snap);

        uint256 minOut = (honest * 99) / 100;
        assertGt(minOut, 1);

        uint256 dump = ReactorToken(token).balanceOf(alice) / 2;
        _sell(alice, token, address(usdc), dump);

        vm.startPrank(bob);
        ReactorToken(token).approve(address(userRouter), bought);
        vm.expectRevert();
        userRouter.sell(token, bought, _emptyHops(), minOut, minOut, block.timestamp + 60);
        vm.stopPrank();
    }

    function test_buySandwichOnOfficialPoolReverts() public {
        (address token,) = _instant(
            ReactorFactory.InstantParams({
                name: "BW",
                symbol: "BW",
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

        uint256 snap = vm.snapshotState();
        vm.startPrank(bob);
        usdc.approve(address(userRouter), 50e6);
        uint256 honest = userRouter.buy(token, 50e6, _emptyHops(), 1, block.timestamp + 60);
        vm.stopPrank();
        vm.revertToState(snap);

        uint256 minOut = (honest * 99) / 100;
        assertGt(minOut, 1);

        _buy(alice, token, address(usdc), 20_000e6);

        vm.startPrank(bob);
        usdc.approve(address(userRouter), 50e6);
        vm.expectRevert();
        userRouter.buy(token, 50e6, _emptyHops(), minOut, block.timestamp + 60);
        vm.stopPrank();
    }
}
