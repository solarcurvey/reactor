// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {UserRouteExecutor} from "../../src/UserRouteExecutor.sol";
import {UserRouteQuoter} from "../../src/UserRouteQuoter.sol";
import {LaunchAuthorization} from "../../src/libraries/LaunchAuthorization.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";

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

    /// @notice §BM 31 — one preview call; always reverts PreviewRoute; amountOut > 1
    function test_31_quoter_whole_route_preview() public {
        (address token,) = _instant(
            ReactorFactory.InstantParams({
                name: "QR",
                symbol: "QR",
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
        usdc.mint(address(userQuoter), 50e6);
        try userQuoter.previewBuy(token, 10e6, _emptyHops()) {
            revert("must revert PreviewRoute");
        } catch (bytes memory err) {
            require(err.length >= 4, "short");
            bytes4 sel;
            assembly {
                sel := mload(add(err, 32))
            }
            assertEq(sel, UserRouteQuoter.PreviewRoute.selector);
            bytes memory payload = new bytes(err.length - 4);
            for (uint256 i; i < payload.length; i++) {
                payload[i] = err[i + 4];
            }
            (uint256 amountOut, uint256[] memory hopOuts, bytes32[] memory kinds) =
                abi.decode(payload, (uint256, uint256[], bytes32[]));
            assertGt(amountOut, 1, "preview amountOut dust");
            assertEq(hopOuts.length, 1, "0 hops -> 1 terminal slot");
            assertEq(kinds.length, 1);
            assertEq(kinds[0], userQuoter.KIND_OFFICIAL());
            assertEq(hopOuts[0], amountOut);
        }
    }

    /// @notice Nested USDC→ZEC→ZCAT preview. User wallet has 0 ZEC. Quoter has 0 ZEC
    ///         before the call. Only the input USDC is credited (Foundry deal ≡ eth_call state override).
    function test_nested_preview_without_intermediate_wallet_balances() public {
        address token = _instantZcat(1);
        uint256 bobZec = zec.balanceOf(bob);
        vm.prank(bob);
        zec.transfer(address(0xdead), bobZec);
        assertEq(zec.balanceOf(bob), 0, "user has no intermediate ZEC");
        assertEq(zec.balanceOf(address(userQuoter)), 0, "quoter has no prefunded ZEC");
        // Input-only credit. eth_call stateOverride does the same for the indexer.
        usdc.mint(address(userQuoter), 50e6);
        assertEq(zec.balanceOf(address(userQuoter)), 0, "still no intermediate on quoter");

        try userQuoter.previewBuy(token, 10e6, _hop(address(usdc), address(zec), zecUsdcKey)) {
            revert("must revert PreviewRoute");
        } catch (bytes memory err) {
            require(err.length >= 4, "short");
            bytes4 sel;
            assembly {
                sel := mload(add(err, 32))
            }
            assertEq(sel, UserRouteQuoter.PreviewRoute.selector);
            bytes memory payload = new bytes(err.length - 4);
            for (uint256 i; i < payload.length; i++) {
                payload[i] = err[i + 4];
            }
            (uint256 amountOut, uint256[] memory hopOuts, bytes32[] memory kinds) =
                abi.decode(payload, (uint256, uint256[], bytes32[]));
            assertGt(amountOut, 1, "nested preview amountOut");
            assertGe(kinds.length, 2, "hop + bonding/official");
            assertEq(kinds[0], userQuoter.KIND_EXTERNAL(), "USDC-ZEC hookless");
            assertEq(kinds[kinds.length - 1], userQuoter.KIND_BONDING(), "ZCAT market is bonding");
            assertGt(hopOuts[0], 1, "first hop produced ZEC inside the call");
        }
        assertEq(zec.balanceOf(bob), 0, "user still has no ZEC after quote");
    }

    /// @notice Nested SELL: official/bonding first, then quote→USDC hop. PreviewRoute is hops+1.
    function test_nested_previewSell_hops_plus_terminal() public {
        address token = _instantZcat(1);
        uint256 bought = _buy(alice, token, address(zec), 5e8);
        // Sell a slice so CurveMath.sellOut stays under realQuote after the 3.5% buy fee.
        uint256 sellAmt = bought / 2;
        vm.prank(alice);
        ReactorToken(token).transfer(address(userQuoter), sellAmt);
        try userQuoter.previewSell(token, sellAmt, _hop(address(zec), address(usdc), zecUsdcKey)) {
            revert("must revert PreviewRoute");
        } catch (bytes memory err) {
            (uint256 amountOut, uint256[] memory hopOuts, bytes32[] memory kinds) = _decodePreview(err);
            assertGt(amountOut, 1, "nested sell amountOut");
            assertEq(hopOuts.length, 2, "1 routing hop + terminal market leg");
            assertEq(kinds.length, 2, "kinds is hops+1");
            assertTrue(
                kinds[0] == userQuoter.KIND_BONDING() || kinds[0] == userQuoter.KIND_OFFICIAL(),
                "SELL terminal first"
            );
            assertEq(kinds[1], userQuoter.KIND_EXTERNAL(), "SELL routing slot last");
            assertEq(amountOut, hopOuts[1], "amountOut is final USDC");
            assertGt(hopOuts[0], 1, "terminal quote out");
        }
    }

    /// @notice USDC→ZEC (hookless) → ZCAT (official) → CAT (bonding). Preview kinds must
    ///         keep official identity on the ZEC→ZCAT hop so fee-leg disclosure can list two 3.5%s.
    function test_nested_preview_kinds_official_intermediate_buy_and_sell() public {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);
        uint256 vq0 = CurveMath.virtualQuote0(ReactorConstants.DEFAULT_SUPPLY, 18);
        ReactorFactory.InstantParams memory catP = ReactorFactory.InstantParams({
            name: "CAT",
            symbol: "CAT",
            decimals: 18,
            supply: 0,
            quote: zcat,
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
        (LaunchAuthorization.Auth memory priced, bytes memory sig) =
            _launchAuthIdentity(alice, catP, vq0, LaunchAuthorization.INSTANT_CURVE_V1, LaunchAuthorization.MODE_STANDARD);
        vm.prank(alice);
        (address cat,) = factory.launchStandard(catP, priced, sig);

        usdc.mint(address(userQuoter), 80e6);
        try userQuoter.previewBuy(
            cat, 40e6, _twoHops(address(usdc), address(zec), zecUsdcKey, zcat, _key(zcat, address(zec)))
        ) {
            revert("must revert PreviewRoute");
        } catch (bytes memory err) {
            (uint256 amountOut, uint256[] memory hopOuts, bytes32[] memory kinds) = _decodePreview(err);
            assertGt(amountOut, 1, "CAT buy preview");
            assertEq(kinds.length, 3, "USDC-ZEC, ZEC-ZCAT, ZCAT-CAT");
            assertEq(kinds[0], userQuoter.KIND_EXTERNAL(), "USDC-ZEC hookless");
            assertEq(kinds[1], userQuoter.KIND_OFFICIAL(), "ZEC-ZCAT official 3.5%");
            assertEq(kinds[2], userQuoter.KIND_BONDING(), "ZCAT-CAT bonding 3.5%");
            assertGt(hopOuts[0], 1);
            assertGt(hopOuts[1], 1);
        }

        vm.startPrank(bob);
        usdc.approve(address(userRouter), 40e6);
        uint256 catBal = userRouter.buy(
            cat,
            40e6,
            _twoHops(address(usdc), address(zec), zecUsdcKey, zcat, _key(zcat, address(zec))),
            1,
            block.timestamp + 60
        );
        ReactorToken(cat).transfer(address(userQuoter), catBal / 2);
        vm.stopPrank();

        uint256 sellIn = ReactorToken(cat).balanceOf(address(userQuoter));
        require(sellIn > 1, "need CAT to preview sell");
        try userQuoter.previewSell(
            cat, sellIn, _twoHops(zcat, address(zec), _key(zcat, address(zec)), address(usdc), zecUsdcKey)
        ) {
            revert("must revert PreviewRoute");
        } catch (bytes memory err) {
            (uint256 amountOut,, bytes32[] memory kinds) = _decodePreview(err);
            assertGt(amountOut, 1, "CAT sell preview");
            assertEq(kinds.length, 3, "CAT-ZCAT, ZCAT-ZEC, ZEC-USDC");
            assertEq(kinds[0], userQuoter.KIND_BONDING(), "CAT-ZCAT bonding 3.5%");
            assertEq(kinds[1], userQuoter.KIND_OFFICIAL(), "ZCAT-ZEC official 3.5%");
            assertEq(kinds[2], userQuoter.KIND_EXTERNAL(), "ZEC-USDC hookless");
        }
    }

    function _decodePreview(bytes memory err)
        internal
        pure
        returns (uint256 amountOut, uint256[] memory hopOuts, bytes32[] memory kinds)
    {
        require(err.length >= 4, "short");
        bytes4 sel;
        assembly {
            sel := mload(add(err, 32))
        }
        assertEq(sel, UserRouteQuoter.PreviewRoute.selector);
        bytes memory payload = new bytes(err.length - 4);
        for (uint256 i; i < payload.length; i++) {
            payload[i] = err[i + 4];
        }
        (amountOut, hopOuts, kinds) = abi.decode(payload, (uint256, uint256[], bytes32[]));
    }
}
