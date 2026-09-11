// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";
import {BuybackVault} from "../../src/BuybackVault.sol";
import {FlywheelVault} from "../../src/FlywheelVault.sol";
import {ReactorGuardian} from "../../src/ReactorGuardian.sol";
import {ReactorHook} from "../../src/ReactorHook.sol";
import {ReactorLiquidityVault} from "../../src/ReactorLiquidityVault.sol";
import {ReactorRouter} from "../../src/ReactorRouter.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {IFeeSink} from "../../src/interfaces/IFeeSink.sol";
import {InstantCurve} from "../../src/InstantCurve.sol";
import {SelfBurnVault} from "../../src/SelfBurnVault.sol";

/// @notice P0-3: every one-time address assignment rejects first-caller / attacker frontrun.
contract FrontrunBindTest is Base {
    function test_registryBindFactory_attackerFrontrun() public {
        QuoteAssetRegistry r = new QuoteAssetRegistry(auth);
        vm.prank(alice);
        vm.expectRevert(QuoteAssetRegistry.NotGuardian.selector);
        r.bindFactory(alice);
        r.bindFactory(address(1));
        vm.expectRevert(QuoteAssetRegistry.AlreadyBound.selector);
        r.bindFactory(address(2));
    }

    function test_buybackBindFactory_attackerFrontrun() public {
        BuybackVault b = new BuybackVault(
            auth, address(core), address(hook), address(usdc), pm, address(router), registry, 1
        );
        vm.prank(alice);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        b.bindFactory(alice);
        b.bindFactory(address(1));
        vm.expectRevert(BuybackVault.AlreadySet.selector);
        b.bindFactory(address(2));
    }

    function test_flywheelBind_attackerFrontrun() public {
        FlywheelVault f = new FlywheelVault(auth, address(hook), address(usdc), address(core), pm, address(router));
        vm.prank(alice);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        f.bind(ReactorFactory(address(1)));
        f.bind(factory);
        vm.expectRevert(FlywheelVault.AlreadyBound.selector);
        f.bind(factory);
    }

    function test_hookBinds_attackerFrontrun() public {
        vm.startPrank(alice);
        vm.expectRevert(ReactorHook.NotGuardian.selector);
        hook.bindFactory(alice);
        vm.expectRevert(ReactorHook.NotGuardian.selector);
        hook.bindBuyback(BuybackVault(alice));
        vm.expectRevert(ReactorHook.NotGuardian.selector);
        hook.bindFlywheel(IFeeSink(alice));
        vm.expectRevert(ReactorHook.NotGuardian.selector);
        hook.bindCurve(alice);
        vm.expectRevert(ReactorHook.NotGuardian.selector);
        hook.bindSelfBurn(alice);
        vm.stopPrank();
        vm.expectRevert(ReactorHook.AlreadyBound.selector);
        hook.bindFactory(address(factory));
    }

    function test_vaultBindFactory_attackerFrontrun() public {
        ReactorLiquidityVault v = new ReactorLiquidityVault(pm, auth);
        vm.prank(alice);
        vm.expectRevert(ReactorLiquidityVault.NotGuardian.selector);
        v.bindFactory(alice);
        v.bindFactory(address(factory));
        vm.expectRevert(ReactorLiquidityVault.AlreadyBound.selector);
        v.bindFactory(address(1));
    }

    function test_routerProtocolVault_attackerAndPostSeal() public {
        vm.prank(alice);
        vm.expectRevert();
        router.setProtocolVault(alice, true);
        vm.expectRevert(ReactorRouter.Sealed.selector);
        router.setProtocolVault(address(selfBurn), true);
        vm.prank(alice);
        vm.expectRevert();
        router.sealProtocolVaults();
    }

    function test_factoryBindCurve_attackerFrontrun() public {
        vm.prank(alice);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        factory.bindCurve(curve, selfBurn);
        vm.expectRevert(ReactorFactory.AlreadyBound.selector);
        factory.bindCurve(curve, selfBurn);
    }

    function test_setUsdc_attackerAndRepeat() public {
        QuoteAssetRegistry r = new QuoteAssetRegistry(auth);
        vm.prank(alice);
        vm.expectRevert(QuoteAssetRegistry.NotGuardian.selector);
        r.setUsdc(address(usdc));
        r.setUsdc(address(usdc));
        vm.expectRevert(QuoteAssetRegistry.BadUsdc.selector);
        r.setUsdc(address(zec));
    }

    function test_noOwnableResidue() public {
        (bool ok,) = address(factory).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
        (ok,) = address(hook).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
        (ok,) = address(buyback).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
        (ok,) = address(registry).call(abi.encodeWithSignature("transferOwnership(address)", alice));
        assertFalse(ok);
        (ok,) = address(hook).call(abi.encodeWithSignature("bootstrap()"));
        assertFalse(ok);
        (ok,) = address(router).call(abi.encodeWithSignature("bootstrap()"));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("bootstrap()"));
        assertFalse(ok);
    }
}
