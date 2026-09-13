// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {ReactorHook} from "../../src/ReactorHook.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorRouter} from "../../src/ReactorRouter.sol";
import {ReactorLiquidityVault} from "../../src/ReactorLiquidityVault.sol";
import {BuybackVault} from "../../src/BuybackVault.sol";
import {FlywheelVault} from "../../src/FlywheelVault.sol";
import {IFeeSink} from "../../src/interfaces/IFeeSink.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";
import {TestCORE} from "../../src/TestCORE.sol";
import {TickerRegistry} from "../../src/TickerRegistry.sol";
import {MockERC20} from "../../src/MockERC20.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {HookMiner} from "../../src/libraries/HookMiner.sol";
import {InstantCurve, IInstantFactory} from "../../src/InstantCurve.sol";
import {SelfBurnVault} from "../../src/SelfBurnVault.sol";
import {ReactorGuardian} from "../../src/ReactorGuardian.sol";
import {UniswapV4Adapter} from "../../src/adapters/UniswapV4Adapter.sol";
import {ProtocolV4Adapter} from "../../src/adapters/ProtocolV4Adapter.sol";
import {IReactorSwapper} from "../../src/interfaces/IReactorSwapper.sol";
import {UserRouteExecutor} from "../../src/UserRouteExecutor.sol";
import {CoreVesting} from "../../src/CoreVesting.sol";
import {CoreLiquidityVault} from "../../src/CoreLiquidityVault.sol";
import {CoreBuybackExecutor} from "../../src/CoreBuybackExecutor.sol";
import {InstantLaunchModule} from "../../src/InstantLaunchModule.sol";
import {GenesisTypes} from "../../src/libraries/GenesisTypes.sol";
import {GenesisVerify} from "../../src/libraries/GenesisVerify.sol";

/// @notice #85 EOA completeGenesis: onlyGuardian, one-shot, seal, Safe path still works.
contract CompleteGenesisTest is Test {
    address internal eoa;
    address internal keeper;
    address internal pricing;
    address internal launchSig;
    address internal attacker;

    ReactorGuardian internal auth;
    PoolManager internal pm;
    QuoteAssetRegistry internal registry;
    TestCORE internal core;
    TickerRegistry internal tickers;
    MockERC20 internal usdc;
    ReactorLiquidityVault internal vault;
    ReactorRouter internal router;
    ReactorHook internal hook;
    BuybackVault internal buyback;
    FlywheelVault internal flywheel;
    ReactorFactory internal factory;
    InstantLaunchModule internal launchMod;
    InstantCurve internal curve;
    SelfBurnVault internal selfBurn;
    UniswapV4Adapter internal v4Adapter;
    ProtocolV4Adapter internal protocolAdapter;
    UserRouteExecutor internal userRouter;
    CoreVesting internal vesting;
    CoreLiquidityVault internal coreLp;
    CoreBuybackExecutor internal coreBuyback;

    function setUp() public {
        eoa = makeAddr("eoaGuardian");
        keeper = makeAddr("keeper");
        pricing = makeAddr("pricingSigner");
        launchSig = makeAddr("launchSigner");
        attacker = makeAddr("attacker");
        _deployUnsigned();
    }

    function test_isGuardian_eoaOnly_authNotGuardianUntilProxy() public view {
        assertTrue(auth.isGuardian(eoa));
        assertFalse(auth.isGuardian(address(auth)));
        assertFalse(auth.isGuardian(attacker));
        assertFalse(auth.genesisSealed());
        assertTrue(auth.launchesPaused());
    }

    function test_completeGenesis_happyPath_staysPaused_sealsProxy() public {
        vm.prank(eoa);
        auth.completeGenesis(_wiring(), false);

        assertTrue(auth.genesisSealed());
        assertFalse(auth.genesisFinalized());
        assertTrue(auth.launchesPaused());
        assertFalse(auth.isGuardian(address(auth)));
        assertTrue(auth.isGuardian(eoa));
        assertEq(auth.pricingSigner(), pricing);
        assertEq(auth.launchSigner(), launchSig);
        assertTrue(registry.isUsdPegOne(address(usdc)));
        assertTrue(router.protocolVaultsSealed());
        assertTrue(coreLp.locked());
        assertEq(curve.routeExecutor(), address(userRouter));
        assertEq(factory.FACTORY_VERSION(), 1);
        assertEq(ReactorConstants.PROTOCOL_FEE_BPS, 350);
        assertEq(vesting.t0(), 0);
        assertEq(core.balanceOf(eoa), 0);
        assertEq(core.balanceOf(address(this)), 0);

        GenesisVerify.verifyProduction(auth, eoa, keeper, address(this), core, vesting, coreLp, registry, router);
        GenesisVerify.verifyFullyWired(
            auth,
            eoa,
            keeper,
            pricing,
            address(this),
            address(v4Adapter),
            address(protocolAdapter),
            address(factory),
            address(curve),
            address(selfBurn),
            address(userRouter)
        );
    }

    function test_completeGenesis_nonGuardianReverts() public {
        GenesisTypes.Wiring memory w = _wiring();
        vm.prank(attacker);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        auth.completeGenesis(w, false);
        vm.prank(address(this));
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        auth.completeGenesis(w, false);
        vm.prank(address(auth));
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        auth.completeGenesis(w, false);
        vm.prank(keeper);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        auth.completeGenesis(w, false);
        assertFalse(auth.genesisSealed());
    }

    function test_completeGenesis_doubleCallReverts() public {
        GenesisTypes.Wiring memory w = _wiring();
        vm.prank(eoa);
        auth.completeGenesis(w, false);
        vm.prank(eoa);
        vm.expectRevert(ReactorGuardian.GenesisAlreadySealed.selector);
        auth.completeGenesis(w, false);
    }

    function test_postSeal_authContractCannotBind_eoaStillCan() public {
        vm.prank(eoa);
        auth.completeGenesis(_wiring(), false);
        assertFalse(auth.isGuardian(address(auth)));

        QuoteAssetRegistry fresh = new QuoteAssetRegistry(auth);
        vm.prank(address(auth));
        vm.expectRevert(QuoteAssetRegistry.NotGuardian.selector);
        fresh.bindFactory(address(factory));
        vm.prank(attacker);
        vm.expectRevert(QuoteAssetRegistry.NotGuardian.selector);
        fresh.bindFactory(address(factory));
        vm.prank(eoa);
        fresh.bindFactory(address(factory));
        assertEq(fresh.factory(), address(factory));

        vm.prank(address(auth));
        vm.expectRevert(QuoteAssetRegistry.NotGuardian.selector);
        registry.setEnabled(address(usdc), false);
        vm.prank(eoa);
        registry.setEnabled(address(usdc), false);
        assertFalse(registry.isEnabled(address(usdc)));
        vm.prank(eoa);
        registry.setEnabled(address(usdc), true);
    }

    function test_finalizeGenesis_afterVerifyGap() public {
        vm.prank(eoa);
        auth.completeGenesis(_wiring(), false);
        vm.prank(attacker);
        vm.expectRevert(ReactorGuardian.NotGuardian.selector);
        auth.finalizeGenesis(address(vesting));
        vm.prank(eoa);
        auth.finalizeGenesis(address(vesting));
        assertTrue(auth.genesisFinalized());
        assertFalse(auth.launchesPaused());
        assertGt(vesting.t0(), 0);
        assertFalse(auth.isGuardian(address(auth)));
        vm.prank(eoa);
        vm.expectRevert(ReactorGuardian.LaunchesMustStayPaused.selector);
        auth.finalizeGenesis(address(vesting));
    }

    function test_completeGenesis_oneShotUnpause_internalVerify() public {
        vm.prank(eoa);
        auth.completeGenesis(_wiring(), true);
        assertTrue(auth.genesisSealed());
        assertTrue(auth.genesisFinalized());
        assertFalse(auth.launchesPaused());
        assertGt(vesting.t0(), 0);
        assertFalse(auth.isGuardian(address(auth)));
        vm.prank(eoa);
        vm.expectRevert(ReactorGuardian.GenesisAlreadySealed.selector);
        auth.completeGenesis(_wiring(), true);
    }

    function test_safeStyleIndividualBinds_stillWorkWithoutCompleteGenesis() public {
        assertFalse(auth.genesisSealed());
        vm.prank(eoa);
        auth.bindTickerRegistry(address(tickers));
        vm.prank(eoa);
        auth.setPricingSigner(pricing);
        vm.prank(eoa);
        registry.setUsdc(address(usdc));
        vm.prank(attacker);
        vm.expectRevert(QuoteAssetRegistry.NotGuardian.selector);
        registry.register(address(usdc), "USDC", "USD Coin", 6, "", QuoteAssetRegistry.Category.Stablecoins);
        vm.prank(eoa);
        registry.register(address(usdc), "USDC", "USD Coin", 6, "", QuoteAssetRegistry.Category.Stablecoins);
        vm.prank(address(auth));
        vm.expectRevert(QuoteAssetRegistry.NotGuardian.selector);
        registry.setUsdPegOne(address(usdc), true);
        vm.prank(eoa);
        registry.setUsdPegOne(address(usdc), true);
        assertTrue(registry.isUsdPegOne(address(usdc)));
        assertFalse(auth.isGuardian(address(auth)));
        assertTrue(auth.launchesPaused());
    }

    function test_completeGenesis_revertsIfAlreadyUnpaused() public {
        vm.prank(eoa);
        auth.pauseLaunches(false);
        vm.prank(eoa);
        vm.expectRevert(ReactorGuardian.LaunchesMustStayPaused.selector);
        auth.completeGenesis(_wiring(), false);
    }

    function test_completeGenesis_keyReuseReverts() public {
        GenesisTypes.Wiring memory w = _wiring();
        w.pricingSigner = keeper;
        vm.prank(eoa);
        vm.expectRevert(ReactorGuardian.KeyReuse.selector);
        auth.completeGenesis(w, false);
    }

    function test_finalizeGenesis_beforeCompleteReverts() public {
        vm.prank(eoa);
        vm.expectRevert(ReactorGuardian.GenesisNotComplete.selector);
        auth.finalizeGenesis(address(vesting));
    }

    function _wiring() internal view returns (GenesisTypes.Wiring memory w) {
        w.pricingSigner = pricing;
        w.launchSigner = launchSig;
        w.deployer = address(this);
        w.tickers = address(tickers);
        w.factory = address(factory);
        w.registry = address(registry);
        w.usdc = address(usdc);
        w.hook = address(hook);
        w.coreLp = address(coreLp);
        w.userAdapter = address(v4Adapter);
        w.protocolAdapter = address(protocolAdapter);
        w.buyback = address(buyback);
        w.flywheel = address(flywheel);
        w.launchModule = address(launchMod);
        w.vault = address(vault);
        w.curve = address(curve);
        w.selfBurn = address(selfBurn);
        w.coreBuyback = address(coreBuyback);
        w.router = address(router);
        w.userRouter = address(userRouter);
        w.vesting = address(vesting);
        w.core = address(core);
    }

    /// @notice Constructors only — matches `SAFE_GENESIS=true` / `_deployUnsigned`.
    function _deployUnsigned() internal {
        auth = new ReactorGuardian(eoa, keeper);
        tickers = new TickerRegistry(auth);
        pm = new PoolManager(address(this));
        registry = new QuoteAssetRegistry(auth);
        core = new TestCORE(address(this));
        usdc = new MockERC20("USD Coin", "USDC", 6, 0, address(this));
        usdc.mint(address(this), 100_000_000e6);
        vault = new ReactorLiquidityVault(pm, auth);
        router = new ReactorRouter(pm, auth);

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory ctor = abi.encode(pm, registry, address(core), address(vault), auth);
        (address hookAddr, bytes32 salt) = HookMiner.find(address(this), flags, type(ReactorHook).creationCode, ctor);
        hook = new ReactorHook{salt: salt}(pm, registry, address(core), address(vault), auth);
        require(address(hook) == hookAddr, "hook salt");

        vesting = new CoreVesting(address(core), auth, 0);
        coreLp = new CoreLiquidityVault(pm, auth, hook, address(core), address(usdc));
        core.genesis(address(vesting), address(coreLp));
        v4Adapter = new UniswapV4Adapter(IReactorSwapper(address(router)), auth, address(hook));
        protocolAdapter = new ProtocolV4Adapter(IReactorSwapper(address(router)), auth, address(hook));
        buyback = new BuybackVault(
            auth,
            address(core),
            address(hook),
            address(usdc),
            pm,
            address(router),
            registry,
            ReactorConstants.DEFAULT_BUYBACK_THRESHOLD
        );
        flywheel = new FlywheelVault(auth, address(hook), address(usdc), address(core), pm, address(router));
        factory = new ReactorFactory(hook, router, vault, registry, address(core), auth, tickers);
        launchMod = new InstantLaunchModule(
            address(factory),
            auth,
            tickers,
            registry,
            IPoolManager(address(pm)),
            hook,
            vault,
            address(core),
            address(factory.fairVault()),
            factory.authDomain()
        );
        curve = new InstantCurve(IInstantFactory(address(factory)), hook, router, vault, registry, pm, auth);
        selfBurn = new SelfBurnVault(auth, address(factory), address(hook), curve, router);
        coreBuyback = new CoreBuybackExecutor(
            auth, hook, IReactorSwapper(address(router)), address(core), address(usdc), address(buyback)
        );
        userRouter = new UserRouteExecutor(auth, hook, IReactorSwapper(address(router)), curve, address(usdc));
        require(auth.launchesPaused(), "paused");
        require(curve.routeExecutor() == address(0), "executor waits");
        require(core.balanceOf(eoa) == 0, "guardian core");
    }
}
