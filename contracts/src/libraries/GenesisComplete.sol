// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "../ReactorGuardian.sol";
import {ReactorConstants} from "../ReactorConstants.sol";
import {GenesisTypes} from "./GenesisTypes.sol";
import {
    IQuoteGenesis,
    IHookGenesis,
    ICoreLpGenesis,
    IVaultGenesis,
    IFactoryGenesis,
    IFlywheelGenesis,
    IBuybackGenesis,
    IRouterGenesis,
    ICurveGenesis,
    ITickerGenesis,
    ICoreTokenView
} from "../interfaces/IGenesisTargets.sol";

/// @notice Batch-A wiring used by `ReactorGuardian.completeGenesis`. Caller is the Guardian
///         contract (`msg.sender` on peripherals = auth) while the transient genesis proxy is on.
library GenesisComplete {
    uint8 internal constant STABLECOINS = 4;

    function wire(GenesisTypes.Wiring calldata w) internal {
        IQuoteGenesis registry = IQuoteGenesis(w.registry);
        registry.setUsdc(w.usdc);
        registry.register(w.usdc, "USDC", "USD Coin", 6, "", STABLECOINS);
        registry.setUsdPegOne(w.usdc, true);
        registry.setBuybackRoute(w.usdc, true, false);

        IHookGenesis hook = IHookGenesis(w.hook);
        hook.bindCoreVault(w.coreLp);
        ICoreLpGenesis(w.coreLp).initializeAndLock();

        hook.bindBuyback(w.buyback);
        hook.bindFlywheel(w.flywheel);
        hook.bindFactory(w.factory);
        hook.bindLaunchModule(w.launchModule);

        IVaultGenesis vault = IVaultGenesis(w.vault);
        vault.bindFactory(w.factory);
        vault.bindLaunchModule(w.launchModule);
        registry.bindFactory(w.factory);
        IFlywheelGenesis(w.flywheel).bind(w.factory);
        IBuybackGenesis(w.buyback).bindFactory(w.factory);

        IFactoryGenesis factory = IFactoryGenesis(w.factory);
        factory.bindCurve(w.curve, w.selfBurn);
        factory.bindLaunchModule(w.launchModule);
        hook.bindCurve(w.curve);
        hook.bindSelfBurn(w.selfBurn);
        IBuybackGenesis(w.buyback).bindExecutor(w.coreBuyback);

        IRouterGenesis router = IRouterGenesis(w.router);
        router.setProtocolVault(w.selfBurn, true);
        router.setProtocolVault(w.flywheel, true);
        router.setProtocolVault(w.coreBuyback, true);
        router.setProtocolVault(w.protocolAdapter, true);
        router.sealProtocolVaults();

        ICurveGenesis(w.curve).bindRouteExecutor(w.userRouter);
    }

    /// @notice Onchain equivalent of `GenesisVerify.verifyFullyWired` + production accounting/seal/peg.
    function verify(GenesisTypes.Wiring calldata w, ReactorGuardian auth) internal view {
        if (!auth.launchesPaused()) revert ReactorGuardian.LaunchesMustStayPaused();
        if (auth.pricingSigner() != w.pricingSigner) revert ReactorGuardian.BadWiring();
        if (auth.launchSigner() != w.launchSigner) revert ReactorGuardian.BadWiring();
        if (!auth.adapterApproved(w.userAdapter) || !auth.adapterApproved(w.protocolAdapter)) {
            revert ReactorGuardian.BadWiring();
        }
        if (address(auth.tickers()) != w.tickers) revert ReactorGuardian.BadWiring();

        ITickerGenesis tickers = ITickerGenesis(w.tickers);
        if (!tickers.isActiveFactory(w.factory) || tickers.factoryVersionOf(w.factory) != 1) {
            revert ReactorGuardian.BadWiring();
        }

        IQuoteGenesis registry = IQuoteGenesis(w.registry);
        if (registry.usdc() != w.usdc || !registry.isUsdPegOne(w.usdc) || registry.factory() != w.factory) {
            revert ReactorGuardian.BadWiring();
        }

        IHookGenesis hook = IHookGenesis(w.hook);
        if (hook.factory() != w.factory || hook.launchModule() != w.launchModule) revert ReactorGuardian.BadWiring();
        if (hook.curve() != w.curve || hook.coreLpVault() != w.coreLp) revert ReactorGuardian.BadWiring();

        IFactoryGenesis factory = IFactoryGenesis(w.factory);
        if (factory.curve() != w.curve || factory.launchModule() != w.launchModule) revert ReactorGuardian.BadWiring();
        if (factory.selfBurn() != w.selfBurn) revert ReactorGuardian.BadWiring();
        if (factory.instantCurveConfig() != keccak256("REACTOR.InstantCurve.v1")) revert ReactorGuardian.BadWiring();

        if (IVaultGenesis(w.vault).factory() != w.factory) revert ReactorGuardian.BadWiring();
        if (IFlywheelGenesis(w.flywheel).factory() != w.factory) revert ReactorGuardian.BadWiring();
        if (IBuybackGenesis(w.buyback).factory() != w.factory) revert ReactorGuardian.BadWiring();
        if (IBuybackGenesis(w.buyback).executor() != w.coreBuyback) revert ReactorGuardian.BadWiring();
        if (ICurveGenesis(w.curve).routeExecutor() != w.userRouter) revert ReactorGuardian.BadWiring();
        if (!ICoreLpGenesis(w.coreLp).locked()) revert ReactorGuardian.BadWiring();

        IRouterGenesis router = IRouterGenesis(w.router);
        if (!router.protocolVaultsSealed()) revert ReactorGuardian.BadWiring();
        if (!router.protocolVault(w.selfBurn) || !router.protocolVault(w.flywheel)) revert ReactorGuardian.BadWiring();
        if (!router.protocolVault(w.coreBuyback) || !router.protocolVault(w.protocolAdapter)) {
            revert ReactorGuardian.BadWiring();
        }

        ICoreTokenView core = ICoreTokenView(w.core);
        if (core.totalSupply() != 1_000_000_000 ether) revert ReactorGuardian.BadWiring();
        if (core.balanceOf(w.vesting) != ReactorConstants.CORE_VESTING_AMOUNT) revert ReactorGuardian.BadWiring();
        if (core.balanceOf(auth.guardian()) != 0 || core.balanceOf(auth.keeper()) != 0) {
            revert ReactorGuardian.BadWiring();
        }
        if (w.deployer != address(0) && core.balanceOf(w.deployer) != 0) revert ReactorGuardian.BadWiring();
    }
}
