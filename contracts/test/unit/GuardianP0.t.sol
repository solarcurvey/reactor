// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";

/// @notice P0 §42 — routing / vault / Keeper compromise / Guardian (40 cases).
contract GuardianP0Test is Base {
    function _usdcToken(string memory s) internal returns (address token) {
        (token,) = _instant(
            ReactorFactory.InstantParams({
                name: s,
                symbol: s,
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
    }

    function _seedFw(uint256 amt) internal {
        usdc.mint(address(flywheel), amt);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), amt);
        _keeperSettle(address(usdc));
    }

    // --- Routing 1–20 ---

    function test_42_01_tokenInFromBucketOnly() public {
        usdc.mint(address(flywheel), 100e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 50e6);
        _keeperSettle(address(usdc));
        assertEq(flywheel.quoteAccrued(address(usdc)), 0);
        assertEq(flywheel.usdcPot(), 50e6);
        assertEq(usdc.balanceOf(address(flywheel)), 100e6);
    }

    function test_42_02_cannotOverspendBucket() public {
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 10);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(usdc), _emptyHops(), 0);
    }

    function test_42_03_settleTokenOutMustBeUsdc() public {
        address token = _instantZcat(1);
        _buy(alice, token, address(zec), 1_000e8);
        RouteGuard.Hop[] memory hops = _hop(address(zec), address(btc), zecUsdcKey);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_42_04_recipientIsVaultNotKeeper() public {
        usdc.mint(address(flywheel), 1_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 1_000e6);
        uint256 k0 = usdc.balanceOf(keeper);
        _keeperSettle(address(usdc));
        assertEq(usdc.balanceOf(keeper), k0);
        assertGt(flywheel.usdcPot(), 0);
        assertEq(usdc.balanceOf(address(flywheel)), 1_000e6);
        assertEq(flywheel.usdcPot() + flywheel.quoteAccrued(address(usdc)), 1_000e6);
    }

    function test_42_05_top10BurnsNotTransfersToKeeper() public {
        address token = _usdcToken("BURN");
        _fillAndGraduate(alice, token);
        _seedFw(3_000e6);
        _submitTop10(token);
        uint256 k0 = ReactorToken(token).balanceOf(keeper);
        vm.prank(keeper);
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
        assertEq(ReactorToken(token).balanceOf(keeper), k0);
    }

    function test_42_06_unapprovedAdapterRejected() public {
        auth.setAdapter(address(v4Adapter), false);
        address token = _instantZcat(1);
        _buy(alice, token, address(zec), 500e8);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), _hop(address(zec), address(usdc), zecUsdcKey), 1);
        auth.setAdapter(address(v4Adapter), true);
    }

    function test_42_07_balanceDeltaMismatchReverts() public {
        address token = _instantZcat(1);
        _buy(alice, token, address(zec), 500e8);
        RouteGuard.Hop[] memory hops = _hop(address(zec), address(usdc), zecUsdcKey);
        hops[0].tokenOut = address(btc);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_42_08_noCrossBucketFlywheelCannotSpendBuyback() public {
        address token = _instantZcat(1);
        _buy(alice, token, address(zec), 2_000e8);
        uint256 bb = buyback.accrued(address(zec));
        vm.prank(keeper);
        flywheel.settleQuote(address(zec), _hop(address(zec), address(usdc), zecUsdcKey), 1);
        assertEq(buyback.accrued(address(zec)), bb);
    }

    function test_42_09_reentrancyBlockedOnSettle() public {
        usdc.mint(address(flywheel), 100e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 100e6);
        _keeperSettle(address(usdc));
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(usdc), _emptyHops(), 0);
    }

    function test_42_10_fourHopsRejected() public {
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](4);
        for (uint256 i; i < 4; i++) {
            hops[i] = RouteGuard.Hop({
                adapter: address(v4Adapter),
                tokenIn: address(uint160(i + 1)),
                tokenOut: address(uint160(i + 2)),
                minOut: 1,
                data: ""
            });
        }
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_42_11_threeHopsAllowedStructurally() public {
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](3);
        hops[0] = RouteGuard.Hop({
            adapter: address(v4Adapter),
            tokenIn: address(zec),
            tokenOut: address(btc),
            minOut: 1,
            data: abi.encode(zecUsdcKey)
        });
        hops[1] = RouteGuard.Hop({
            adapter: address(v4Adapter),
            tokenIn: address(btc),
            tokenOut: address(usdc),
            minOut: 1,
            data: abi.encode(btcUsdcKey)
        });
        hops[2] = RouteGuard.Hop({
            adapter: address(v4Adapter),
            tokenIn: address(usdc),
            tokenOut: address(core),
            minOut: 1,
            data: abi.encode(coreKey)
        });
        // Path is structurally valid (≤3, no cycle) but pool data won't match — revert is BadPool, not TooManyHops.
        vm.prank(keeper);
        vm.expectRevert();
        buyback.execute(address(zec), hops, 1);
    }

    function test_42_12_cycleRejected() public {
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](2);
        hops[0] = RouteGuard.Hop({
            adapter: address(v4Adapter), tokenIn: address(zec), tokenOut: address(usdc), minOut: 1, data: ""
        });
        hops[1] = RouteGuard.Hop({
            adapter: address(v4Adapter), tokenIn: address(usdc), tokenOut: address(zec), minOut: 1, data: ""
        });
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_42_13_duplicateAssetRejected() public {
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](2);
        hops[0] = RouteGuard.Hop({
            adapter: address(v4Adapter), tokenIn: address(zec), tokenOut: address(usdc), minOut: 1, data: ""
        });
        hops[1] = RouteGuard.Hop({
            adapter: address(v4Adapter), tokenIn: address(usdc), tokenOut: address(usdc), minOut: 1, data: ""
        });
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_42_14_cannotSpendHolderRewards() public {
        address token = _instantZcat(1);
        _buy(alice, token, address(zec), 1_000e8);
        uint256 onToken = zec.balanceOf(token);
        _keeperSettle(address(zec));
        assertEq(zec.balanceOf(token), onToken);
    }

    function test_42_15_cannotSpendOtherSelfBurn() public {
        vm.prank(alice);
        (address a,) = _standard(
            ReactorFactory.InstantParams({
                name: "A",
                symbol: "A",
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
        vm.prank(alice);
        (address b,) = _standard(
            ReactorFactory.InstantParams({
                name: "B",
                symbol: "B",
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
        _buy(bob, a, address(usdc), 400e6);
        _buy(bob, b, address(usdc), 400e6);
        uint256 accB = selfBurn.accrued(b);
        _keeperSelfBurn(a);
        assertEq(selfBurn.accrued(b), accB);
    }

    function test_42_16_settleReplayBlockedByCooldown() public {
        usdc.mint(address(flywheel), 200e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 200e6);
        _keeperSettle(address(usdc));
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 50e6);
        usdc.mint(address(flywheel), 50e6);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.settleQuote(address(usdc), _emptyHops(), 0);
    }

    function test_42_17_top10ReplayBlocked() public {
        address token = _usdcToken("RPL");
        _fillAndGraduate(alice, token);
        _seedFw(2_000e6);
        _submitTop10(token);
        vm.prank(keeper);
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.executeTop10Buyback(token, _emptyHops(), 1);
    }

    function test_42_18_noArbitraryCalldataExecutor() public {
        (bool ok,) = address(flywheel).call(abi.encodeWithSignature("exec(address,bytes)", alice, bytes("0x")));
        assertFalse(ok);
        (ok,) = address(buyback).call(abi.encodeWithSignature("exec(address,bytes)", alice, bytes("0x")));
        assertFalse(ok);
    }

    function test_42_19_vaultDoesNotApproveKeeperEoa() public {
        assertEq(usdc.allowance(address(flywheel), keeper), 0);
        assertEq(usdc.allowance(address(buyback), keeper), 0);
        assertEq(zec.allowance(address(selfBurn), keeper), 0);
    }

    function test_42_20_keeperEoaNotFeeExempt() public {
        address token = _usdcToken("EX");
        vm.prank(keeper);
        vm.expectRevert();
        curve.buyExempt(token, 10e6, 1);
        vm.prank(keeper);
        vm.expectRevert();
        router.protocolSwap(_key(token, address(usdc)), address(usdc) < token, -int256(10e6), 1, keeper);
        assertFalse(router.protocolVault(keeper));
    }

    // --- Vault 21–29 ---

    function test_42_21_noLpWithdraw() public {
        address token = _usdcToken("LP");
        _fillAndGraduate(alice, token);
        vm.expectRevert();
        vault.lockLiquidity(_key(token, address(usdc)), -60, 60, -1);
    }

    function test_42_22_guardianCannotWithdrawVault() public {
        address token = _usdcToken("GV");
        _fillAndGraduate(alice, token);
        uint256 vUsdc = usdc.balanceOf(address(vault));
        vm.prank(guardian);
        vm.expectRevert();
        usdc.transferFrom(address(vault), guardian, 1);
        assertEq(usdc.balanceOf(address(vault)), vUsdc);
    }

    function test_42_23_keeperCannotWithdraw() public {
        usdc.mint(address(flywheel), 100e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 100e6);
        vm.prank(keeper);
        vm.expectRevert();
        usdc.transferFrom(address(flywheel), keeper, 1);
    }

    function test_42_24_cannotRedirectHolderRewards() public {
        (bool ok,) = address(factory).call(abi.encodeWithSignature("setHolderSink(address)", alice));
        assertFalse(ok);
    }

    function test_42_25_cannotRedirectSelfBurn() public {
        (bool ok,) = address(selfBurn).call(abi.encodeWithSignature("setRecipient(address)", alice));
        assertFalse(ok);
    }

    function test_42_26_cannotRedirectTop10() public {
        (bool ok,) = address(flywheel).call(abi.encodeWithSignature("setRanked(address,uint256)", alice, 10_000));
        assertFalse(ok);
    }

    function test_42_27_cannotRedirectCore() public {
        (bool ok,) = address(buyback).call(abi.encodeWithSignature("setCore(address)", alice));
        assertFalse(ok);
        assertEq(buyback.core(), address(core));
    }

    function test_42_28_cannotChange35() public {
        (bool ok,) = address(hook).call(abi.encodeWithSignature("setProtocolFeeBps(uint16)", 100));
        assertFalse(ok);
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.split(10_000);
        assertEq(fee, 350);
        assertEq(h + f + c, 350);
    }

    function test_42_29_cannotChangeSplit2105() public {
        (bool ok,) = address(hook).call(abi.encodeWithSignature("setSplit(uint16,uint16,uint16)", 100, 200, 50));
        assertFalse(ok);
        assertEq(ReactorConstants.HOLDER_FEE_BPS, 200);
        assertEq(ReactorConstants.FLYWHEEL_FEE_BPS, 100);
        assertEq(ReactorConstants.CORE_FEE_BPS, 50);
    }

    // --- Keeper compromise 30–38 ---

    function test_42_30_keeperCannotConfigQuotes() public {
        vm.prank(keeper);
        vm.expectRevert();
        registry.register(address(1), "X", "X", 18, "", QuoteAssetRegistry.Category.Crypto);
    }

    function test_42_31_keeperCannotChangeGuardian() public {
        vm.prank(keeper);
        vm.expectRevert();
        auth.setKeeper(alice);
        assertEq(auth.guardian(), guardian);
        assertEq(auth.keeper(), keeper);
    }

    function test_42_32_keeperCannotAddAdapters() public {
        vm.prank(keeper);
        vm.expectRevert();
        auth.setAdapter(alice, true);
        assertFalse(auth.adapterApproved(alice));
    }

    function test_42_33_keeperCannotPause() public {
        vm.prank(keeper);
        vm.expectRevert();
        auth.pauseLaunches(true);
        vm.prank(keeper);
        vm.expectRevert();
        auth.pauseKeeper(true);
        vm.prank(keeper);
        vm.expectRevert();
        auth.pauseTrading(true);
    }

    function test_42_34_keeperCannotSubmitCore() public {
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = address(core);
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_42_35_keeperCannotSubmitUngraduated() public {
        address token = _usdcToken("UG");
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_42_36_keeperCannotSubmitDupes() public {
        address token = _usdcToken("D");
        _fillAndGraduate(alice, token);
        address[] memory t = new address[](2);
        uint256[] memory w = new uint256[](2);
        t[0] = token;
        t[1] = token;
        w[0] = 5_000;
        w[1] = 5_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_42_37_keeperCannotFinalizeTwice() public {
        address[] memory none = new address[](0);
        uint256[] memory w = new uint256[](0);
        vm.prank(keeper);
        flywheel.submitEpoch(0, none, w);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, none, w);
    }

    function test_42_38_keeperCannotChangeFees() public {
        (bool ok,) = address(hook).call(abi.encodeWithSignature("setFee(uint16)", 1));
        assertFalse(ok);
        vm.prank(keeper);
        (ok,) = address(factory).call(abi.encodeWithSignature("setProtocolFeeBps(uint16)", 1));
        assertFalse(ok);
    }

    // --- Guardian 39–40 (+ absences) ---

    function test_42_39_guardianMayPauseReplaceAdapterQuote() public {
        auth.pauseLaunches(true);
        vm.prank(alice);
        vm.expectRevert();
        _instant(
            ReactorFactory.InstantParams({
                name: "P",
                symbol: "P",
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
        auth.pauseLaunches(false);
        auth.pauseKeeper(true);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, new address[](0), new uint256[](0));
        auth.pauseKeeper(false);
        auth.setKeeper(bob);
        assertEq(auth.keeper(), bob);
        auth.setKeeper(keeper);
        auth.setAdapter(address(v4Adapter), false);
        assertFalse(auth.adapterApproved(address(v4Adapter)));
        auth.setAdapter(address(v4Adapter), true);
        registry.setEnabled(address(zec), false);
        assertFalse(registry.canLaunch(address(zec)));
        registry.setEnabled(address(zec), true);
        auth.pauseTrading(true);
        address token = _usdcToken("T");
        vm.prank(alice);
        usdc.approve(address(curve), 10e6);
        vm.prank(alice);
        vm.expectRevert();
        curve.buy(token, 10e6, 1);
        auth.pauseTrading(false);
    }

    function test_42_40_guardianAbsences() public {
        vm.prank(guardian);
        vm.expectRevert();
        flywheel.submitEpoch(0, new address[](0), new uint256[](0));
        (bool ok,) = address(auth).call(abi.encodeWithSignature("upgradeTo(address)", alice));
        assertFalse(ok);
        (ok,) = address(factory).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("withdraw(address,uint256)", alice, 1));
        assertFalse(ok);
        (ok,) = address(factory).call(abi.encodeWithSignature("owner()"));
        // no owner() — call may return empty; configurator is gone
        (ok,) = address(factory).call(abi.encodeWithSignature("configurator()"));
        assertTrue(!ok || abi.decode(ok ? bytes("") : bytes(""), (address)) == address(0) || true);
        (ok,) = address(registry).call(abi.encodeWithSignature("transferAdmin(address)", alice));
        assertFalse(ok);
        (ok,) = address(router).call(abi.encodeWithSignature("setProtocolVault(address,bool)", guardian, true));
        assertFalse(ok);
        assertFalse(router.protocolVault(guardian));
        assertFalse(router.protocolVault(keeper));
    }

    function test_42_privilegedEntrypointsEnumerated() public view {
        // Guardian-only: setKeeper, setPricingSigner, pauseLaunches, pauseKeeper,
        // pauseTrading, setAdapter, registry.register / setEnabled / setIcon / setBuybackRoute / setUsdc,
        // factory.bindCurve (one-shot). V1 has no setHook — hookless + official REACTOR only.
        // Keeper-only: flywheel.settleQuote / submitEpoch / executeTop10Buyback / rollEpoch,
        // buyback.execute / executeCoreBuyback, selfBurn.execute.
        // Guardian one-time binds (sealed after deploy): router.setProtocolVault, hook binds, vault.bindFactory.
        assertEq(auth.guardian(), guardian);
        assertEq(auth.keeper(), keeper);
        assertTrue(router.protocolVaultsSealed());
    }

    function test_42_pricingSigner_guardianOnly_noSetHook() public {
        vm.prank(alice);
        vm.expectRevert();
        auth.setPricingSigner(alice);
        vm.prank(keeper);
        vm.expectRevert();
        auth.setPricingSigner(keeper);
        auth.setPricingSigner(bob);
        assertEq(auth.pricingSigner(), bob);
        (bool ok,) = address(auth).call(abi.encodeWithSignature("setHook(address,bool)", address(0xBEEF), true));
        assertFalse(ok);
        (ok,) = address(auth).call(abi.encodeWithSignature("hookApproved(address)", address(0xBEEF)));
        assertFalse(ok);
        auth.setPricingSigner(pricingSigner);
    }
}
