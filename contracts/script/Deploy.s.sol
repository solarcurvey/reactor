// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {ReactorHook} from "../src/ReactorHook.sol";
import {ReactorFactory} from "../src/ReactorFactory.sol";
import {ReactorRouter} from "../src/ReactorRouter.sol";
import {ReactorLiquidityVault} from "../src/ReactorLiquidityVault.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {FlywheelVault} from "../src/FlywheelVault.sol";
import {IFeeSink} from "../src/interfaces/IFeeSink.sol";
import {IReactorSwapper} from "../src/interfaces/IReactorSwapper.sol";
import {QuoteAssetRegistry} from "../src/QuoteAssetRegistry.sol";
import {TestCORE} from "../src/TestCORE.sol";
import {CoreToken} from "../src/CoreToken.sol";
import {TickerRegistry} from "../src/TickerRegistry.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {ReactorConstants} from "../src/ReactorConstants.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {LaunchMath} from "../src/libraries/LaunchMath.sol";
import {LiquidityAmounts} from "../src/libraries/LiquidityAmounts.sol";
import {IERC20MinimalExt} from "../src/interfaces/IERC20MinimalExt.sol";
import {InstantCurve, IInstantFactory} from "../src/InstantCurve.sol";
import {SelfBurnVault} from "../src/SelfBurnVault.sol";
import {ReactorGuardian} from "../src/ReactorGuardian.sol";
import {UniswapV4Adapter} from "../src/adapters/UniswapV4Adapter.sol";
import {ProtocolV4Adapter} from "../src/adapters/ProtocolV4Adapter.sol";
import {RoutingRegistry} from "../src/RoutingRegistry.sol";
import {UserRouteExecutor} from "../src/UserRouteExecutor.sol";
import {UserRouteQuoter} from "../src/UserRouteQuoter.sol";
import {CoreVesting} from "../src/CoreVesting.sol";
import {CoreLiquidityVault} from "../src/CoreLiquidityVault.sol";
import {CoreBuybackExecutor} from "../src/CoreBuybackExecutor.sol";
import {RouteGuard} from "../src/libraries/RouteGuard.sol";
import {InstantLaunchModule} from "../src/InstantLaunchModule.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

contract Deploy is Script {
    struct Addresses {
        PoolManager pm;
        QuoteAssetRegistry registry;
        TestCORE core;
        TickerRegistry tickers;
        MockERC20 usdc;
        MockERC20 zec;
        MockERC20 btc;
        MockERC20 nvda;
        ReactorLiquidityVault vault;
        ReactorRouter router;
        ReactorHook hook;
        BuybackVault buyback;
        FlywheelVault flywheel;
        ReactorFactory factory;
        InstantLaunchModule launchMod;
        InstantCurve curve;
        SelfBurnVault selfBurn;
        ReactorGuardian auth;
        UniswapV4Adapter v4Adapter;
        ProtocolV4Adapter protocolAdapter;
        RoutingRegistry routes;
        UserRouteExecutor userRouter;
        UserRouteQuoter userQuoter;
        CoreVesting vesting;
        CoreLiquidityVault coreLp;
        CoreBuybackExecutor coreBuyback;
    }

    function run() external {
        uint256 pk =
            vm.envOr("DEPLOYER_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);
        address keeper = vm.envOr("KEEPER", deployer);
        address guardian = vm.envOr("GUARDIAN", deployer);
        vm.startBroadcast(pk);
        Addresses memory a = _deployCore(deployer, guardian, keeper);
        bool safeGenesis = vm.envOr("SAFE_GENESIS", false);
        if (safeGenesis) {
            require(guardian != deployer, "SAFE_MUST_BE_GUARDIAN");
            require(a.auth.launchesPaused(), "LAUNCHES_MUST_STAY_PAUSED");
            // Constructors only. Guardian genesis is a later Safe MultiSend — see SafeGenesisBatch.s.sol.
            _deployUnsigned(a);
            require(a.core.balanceOf(deployer) == 0, "DEPLOYER_CORE");
        } else {
            require(guardian == deployer, "LOCAL_GUARDIAN_IS_DEPLOYER");
            _registerQuotes(a);
            _bind(a, deployer);
            _seedRoutes(a);
        }
        vm.stopBroadcast();
        _log(a);
    }

    function _deployCore(address deployer, address guardian, address keeper) internal returns (Addresses memory a) {
        a.auth = new ReactorGuardian(guardian, keeper);
        // launchesPaused starts true. Production Safe unpauses after genesis batch.
        a.pm = new PoolManager(deployer);
        a.registry = new QuoteAssetRegistry(a.auth);
        a.tickers = new TickerRegistry(a.auth);
        a.core = new TestCORE(deployer);
        a.usdc = new MockERC20("USD Coin", "USDC", 6, 0, deployer);
        a.zec = new MockERC20("Mock ZEC", "ZEC", 8, 0, deployer);
        a.btc = new MockERC20("Mock BTC", "BTC", 8, 0, deployer);
        a.nvda = new MockERC20("Mock NVDA", "NVDA", 18, 0, deployer);
        a.usdc.mint(deployer, 100_000_000e6);
        a.zec.mint(deployer, 1_000_000e8);
        a.btc.mint(deployer, 21_000e8);
        a.nvda.mint(deployer, 1_000_000 ether);
        a.vault = new ReactorLiquidityVault(a.pm, a.auth);
        a.router = new ReactorRouter(a.pm, a.auth);
        a.routes = new RoutingRegistry(a.auth);
    }

    function _registerQuotes(Addresses memory a) internal {
        a.registry.setUsdc(address(a.usdc));
        a.registry
            .register(
                address(a.usdc), "USDC", "USD Coin", 6, "/icons/usdc.svg", QuoteAssetRegistry.Category.Stablecoins
            );
        a.registry.register(address(a.zec), "ZEC", "Mock ZEC", 8, "/icons/zec.svg", QuoteAssetRegistry.Category.Crypto);
        a.registry.register(address(a.btc), "BTC", "Mock BTC", 8, "/icons/btc.svg", QuoteAssetRegistry.Category.Crypto);
        a.registry
            .register(address(a.nvda), "NVDA", "Mock NVDA", 18, "/icons/nvda.svg", QuoteAssetRegistry.Category.Stocks);
        a.registry.setBuybackRoute(address(a.usdc), true, false);
        a.registry.setBuybackRoute(address(a.zec), true, true);
        a.registry.setBuybackRoute(address(a.btc), true, true);
    }

    function _bind(Addresses memory a, address deployer) internal {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        address create2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        (address hookAddr, bytes32 salt) = HookMiner.find(
            create2,
            flags,
            type(ReactorHook).creationCode,
            abi.encode(a.pm, a.registry, address(a.core), address(a.vault), a.auth)
        );
        a.hook = new ReactorHook{salt: salt}(a.pm, a.registry, address(a.core), address(a.vault), a.auth);
        require(address(a.hook) == hookAddr, "HOOK");
        a.vesting = new CoreVesting(address(a.core), a.auth, 0);
        a.coreLp = new CoreLiquidityVault(a.pm, a.auth, a.hook, address(a.core), address(a.usdc));
        a.hook.bindCoreVault(address(a.coreLp));
        a.core.genesis(address(a.vesting), address(a.coreLp));
        a.coreLp.initializeAndLock();
        a.v4Adapter = new UniswapV4Adapter(IReactorSwapper(address(a.router)), a.auth, address(a.hook));
        a.protocolAdapter = new ProtocolV4Adapter(IReactorSwapper(address(a.router)), a.auth, address(a.hook));
        a.auth.setAdapter(address(a.v4Adapter), true);
        a.auth.setAdapter(address(a.protocolAdapter), true);
        a.buyback = new BuybackVault(
            a.auth,
            address(a.core),
            address(a.hook),
            address(a.usdc),
            a.pm,
            address(a.router),
            a.registry,
            ReactorConstants.DEFAULT_BUYBACK_THRESHOLD
        );
        a.hook.bindBuyback(a.buyback);
        a.flywheel =
            new FlywheelVault(a.auth, address(a.hook), address(a.usdc), address(a.core), a.pm, address(a.router));
        a.hook.bindFlywheel(IFeeSink(address(a.flywheel)));
        a.auth.bindTickerRegistry(address(a.tickers));
        a.factory = new ReactorFactory(a.hook, a.router, a.vault, a.registry, address(a.core), a.auth, a.tickers);
        a.launchMod = new InstantLaunchModule(
            address(a.factory),
            a.auth,
            a.tickers,
            a.registry,
            IPoolManager(address(a.pm)),
            a.hook,
            a.vault,
            address(a.core),
            address(a.factory.fairVault()),
            a.factory.authDomain()
        );
        a.factory.bindLaunchModule(address(a.launchMod));
        a.auth.authorizeFactory(address(a.factory), 1);
        a.hook.bindFactory(address(a.factory));
        a.hook.bindLaunchModule(address(a.launchMod));
        a.vault.bindFactory(address(a.factory));
        a.vault.bindLaunchModule(address(a.launchMod));
        a.registry.bindFactory(address(a.factory));
        a.flywheel.bind(a.factory);
        a.buyback.bindFactory(address(a.factory));
        a.curve =
            new InstantCurve(IInstantFactory(address(a.factory)), a.hook, a.router, a.vault, a.registry, a.pm, a.auth);
        a.selfBurn = new SelfBurnVault(a.auth, address(a.factory), address(a.hook), a.curve, a.router);
        a.factory.bindCurve(a.curve, a.selfBurn);
        a.hook.bindCurve(address(a.curve));
        a.hook.bindSelfBurn(address(a.selfBurn));
        a.coreBuyback = new CoreBuybackExecutor(
            a.auth, a.hook, IReactorSwapper(address(a.router)), address(a.core), address(a.usdc), address(a.buyback)
        );
        a.buyback.bindExecutor(a.coreBuyback);
        a.router.setProtocolVault(address(a.selfBurn), true);
        a.router.setProtocolVault(address(a.flywheel), true);
        a.router.setProtocolVault(address(a.coreBuyback), true);
        a.router.setProtocolVault(address(a.protocolAdapter), true);
        a.router.sealProtocolVaults();
        a.userRouter =
            new UserRouteExecutor(a.auth, a.hook, IReactorSwapper(address(a.router)), a.curve, address(a.usdc));
        a.userQuoter = new UserRouteQuoter(a.auth, a.hook, IReactorSwapper(address(a.router)), a.curve, address(a.usdc));
        a.curve.bindRouteExecutor(address(a.userRouter));
        _verifyGenesis(a);
        _tinyBuyback(a);
        a.auth.pauseLaunches(false);
        a.vesting.activateLaunch();
    }

    /// @notice Production constructors only. No Guardian calls. Safe MultiSend completes genesis.
    function _deployUnsigned(Addresses memory a) internal {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        address create2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        (address hookAddr, bytes32 salt) = HookMiner.find(
            create2,
            flags,
            type(ReactorHook).creationCode,
            abi.encode(a.pm, a.registry, address(a.core), address(a.vault), a.auth)
        );
        a.hook = new ReactorHook{salt: salt}(a.pm, a.registry, address(a.core), address(a.vault), a.auth);
        require(address(a.hook) == hookAddr, "HOOK");
        a.vesting = new CoreVesting(address(a.core), a.auth, 0);
        a.coreLp = new CoreLiquidityVault(a.pm, a.auth, a.hook, address(a.core), address(a.usdc));
        a.core.genesis(address(a.vesting), address(a.coreLp));
        a.v4Adapter = new UniswapV4Adapter(IReactorSwapper(address(a.router)), a.auth, address(a.hook));
        a.protocolAdapter = new ProtocolV4Adapter(IReactorSwapper(address(a.router)), a.auth, address(a.hook));
        a.buyback = new BuybackVault(
            a.auth,
            address(a.core),
            address(a.hook),
            address(a.usdc),
            a.pm,
            address(a.router),
            a.registry,
            ReactorConstants.DEFAULT_BUYBACK_THRESHOLD
        );
        a.flywheel =
            new FlywheelVault(a.auth, address(a.hook), address(a.usdc), address(a.core), a.pm, address(a.router));
        a.factory = new ReactorFactory(a.hook, a.router, a.vault, a.registry, address(a.core), a.auth, a.tickers);
        a.launchMod = new InstantLaunchModule(
            address(a.factory),
            a.auth,
            a.tickers,
            a.registry,
            IPoolManager(address(a.pm)),
            a.hook,
            a.vault,
            address(a.core),
            address(a.factory.fairVault()),
            a.factory.authDomain()
        );
        a.curve =
            new InstantCurve(IInstantFactory(address(a.factory)), a.hook, a.router, a.vault, a.registry, a.pm, a.auth);
        a.selfBurn = new SelfBurnVault(a.auth, address(a.factory), address(a.hook), a.curve, a.router);
        a.coreBuyback = new CoreBuybackExecutor(
            a.auth, a.hook, IReactorSwapper(address(a.router)), address(a.core), address(a.usdc), address(a.buyback)
        );
        a.userRouter =
            new UserRouteExecutor(a.auth, a.hook, IReactorSwapper(address(a.router)), a.curve, address(a.usdc));
        a.userQuoter = new UserRouteQuoter(a.auth, a.hook, IReactorSwapper(address(a.router)), a.curve, address(a.usdc));
        require(a.auth.launchesPaused(), "LAUNCHES_MUST_STAY_PAUSED");
        require(a.curve.routeExecutor() == address(0), "EXECUTOR_MUST_WAIT_FOR_SAFE");
        require(a.core.balanceOf(a.auth.guardian()) == 0, "GUARDIAN_CORE");
    }

    function _verifyGenesis(Addresses memory a) internal view {
        require(a.core.totalSupply() == 1_000_000_000 ether, "CORE_SUPPLY");
        require(a.core.balanceOf(address(a.vesting)) == 100_000_000 ether, "VEST");
        require(a.core.balanceOf(msg.sender) == 0, "DEPLOYER_CORE");
        require(a.core.balanceOf(a.auth.guardian()) == 0, "GUARDIAN_CORE");
        require(a.core.balanceOf(a.auth.keeper()) == 0, "KEEPER_CORE");
        (address t, address q, bool live) = a.hook.marketOfToken(address(a.core));
        require(live && t == address(a.core) && q == address(a.usdc), "CORE_MARKET");
    }

    function _tinyBuyback(Addresses memory a) internal {
        uint256 inAmt = 100e6;
        IERC20MinimalExt(address(a.usdc)).approve(address(a.router), inAmt);
        a.router.swap(a.coreLp.poolKey(), address(a.usdc) < address(a.core), -int256(inAmt), 1, msg.sender);
        uint256 supplyBefore = a.core.totalSupply();
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](0);
        a.buyback.execute(address(a.usdc), hops, 1);
        require(a.core.totalSupply() < supplyBefore, "BURN");
    }

    function _seedRoutes(Addresses memory a) internal {
        PoolKey memory zecHop = _hookless(address(a.zec), address(a.usdc));
        _seed(a.router, zecHop, address(a.zec), 200_000e8, address(a.usdc), 10_000_000e6);

        PoolKey memory btcHop = _hookless(address(a.btc), address(a.usdc));
        _seed(a.router, btcHop, address(a.btc), 100e8, address(a.usdc), 6_000_000e6);
    }

    function _hookless(address x, address y) internal pure returns (PoolKey memory key) {
        (address a, address b) = x < y ? (x, y) : (y, x);
        key = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _seed(ReactorRouter router, PoolKey memory key, address tokenA, uint256 amtA, address tokenB, uint256 amtB)
        internal
    {
        uint256 amt0 = Currency.unwrap(key.currency0) == tokenA ? amtA : amtB;
        uint256 amt1 = Currency.unwrap(key.currency0) == tokenA ? amtB : amtA;
        uint160 sqrtP = LaunchMath.encodeSqrtPriceX96(amt1, amt0);
        router.poolManager().initialize(key, sqrtP);
        int24 lo = TickMath.minUsableTick(60);
        int24 hi = TickMath.maxUsableTick(60);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), amt0, amt1
        );
        IERC20MinimalExt(tokenA).approve(address(router), type(uint256).max);
        IERC20MinimalExt(tokenB).approve(address(router), type(uint256).max);
        router.addLiquidity(key, lo, hi, int256(uint256(liq)));
    }

    function _log(Addresses memory a) internal {
        console2.log("Guardian", address(a.auth));
        console2.log("Keeper", a.auth.keeper());
        console2.log("PoolManager", address(a.pm));
        console2.log("Registry", address(a.registry));
        console2.log("USDC", address(a.usdc));
        console2.log("ZEC", address(a.zec));
        console2.log("BTC", address(a.btc));
        console2.log("NVDA", address(a.nvda));
        console2.log("CoreToken", address(a.core));
        console2.log("TickerRegistry", address(a.tickers));
        console2.log("Vault", address(a.vault));
        console2.log("Router", address(a.router));
        console2.log("Hook", address(a.hook));
        console2.log("Buyback", address(a.buyback));
        console2.log("Flywheel", address(a.flywheel));
        console2.log("Factory", address(a.factory));
        console2.log("InstantLaunchModule", address(a.launchMod));
        console2.log("InstantCurve", address(a.curve));
        console2.log("SelfBurnVault", address(a.selfBurn));
        console2.log("V4Adapter", address(a.v4Adapter));
        console2.log("ProtocolV4Adapter", address(a.protocolAdapter));
        console2.log("UserRouteExecutor", address(a.userRouter));
        console2.log("UserRouteQuoter", address(a.userQuoter));
        console2.log("CoreVesting", address(a.vesting));
        console2.log("CoreLiquidityVault", address(a.coreLp));
        console2.log("CoreBuybackExecutor", address(a.coreBuyback));
        console2.log("FairVault", address(a.factory.fairVault()));
        console2.log("RoutingRegistry", address(a.routes));
        _write(a);
    }

    function _write(Addresses memory a) internal {
        string memory json = string.concat(
            "{\n",
            '  "network": "local-arc-compatible",\n',
            '  "chainId": 5042002,\n',
            '  "rpc": "http://127.0.0.1:8545",\n',
            '  "claimedArcTestnet": false,\n',
            '  "note": "Anvil chain id 5042002. Not Arc Testnet. Redeployed this session.",\n',
            '  "addresses": {\n',
            _kv("Guardian", address(a.auth)),
            _kv("Keeper", a.auth.keeper()),
            _kv("PricingSigner", a.auth.pricingSigner()),
            _kv("LaunchSigner", a.auth.launchSigner()),
            _kv("PoolManager", address(a.pm)),
            _kv("QuoteAssetRegistry", address(a.registry)),
            _kv("TickerRegistry", address(a.tickers)),
            _kv("TestCORE", address(a.core)),
            _kv("CoreToken", address(a.core)),
            _kv("USDC", address(a.usdc)),
            _kv("ZEC", address(a.zec)),
            _kv("BTC", address(a.btc)),
            _kv("NVDA", address(a.nvda)),
            _kv("ReactorLiquidityVault", address(a.vault)),
            _kv("ReactorRouter", address(a.router)),
            _kv("ReactorHook", address(a.hook)),
            _kv("BuybackVault", address(a.buyback)),
            _kv("FlywheelVault", address(a.flywheel)),
            _kv("ReactorFactory", address(a.factory)),
            _kv("InstantLaunchModule", address(a.launchMod)),
            _kv("InstantCurve", address(a.curve)),
            _kv("SelfBurnVault", address(a.selfBurn)),
            _kv("V4Adapter", address(a.v4Adapter)),
            _kv("ProtocolV4Adapter", address(a.protocolAdapter)),
            _kv("RoutingRegistry", address(a.routes)),
            _kv("UserRouteExecutor", address(a.userRouter)),
            _kv("UserRouteQuoter", address(a.userQuoter)),
            _kv("CoreVesting", address(a.vesting)),
            _kv("CoreLiquidityVault", address(a.coreLp)),
            _kv("CoreBuybackExecutor", address(a.coreBuyback)),
            _kvLast("FairClaimVault", address(a.factory.fairVault())),
            "  },\n",
            '  "hookFlags": "0x30CC",\n',
            '  "v4Core": "e50237c43811bd9b526eff40f26772152a42daba"\n',
            "}\n"
        );
        vm.writeFile("../deployments/local.json", json);
        vm.writeFile("../apps/web/src/lib/deployment.json", json);
        vm.writeFile("../apps/indexer/src/deployment.json", json);
    }

    function _kv(string memory k, address v) internal pure returns (string memory) {
        return string.concat('    "', k, '": "', _hex(v), '",\n');
    }

    function _kvLast(string memory k, address v) internal pure returns (string memory) {
        return string.concat('    "', k, '": "', _hex(v), '"\n');
    }

    function _hex(address v) internal pure returns (string memory) {
        bytes16 hexSymbols = "0123456789abcdef";
        bytes20 data = bytes20(v);
        bytes memory s = new bytes(42);
        s[0] = "0";
        s[1] = "x";
        for (uint256 i; i < 20; i++) {
            s[2 + i * 2] = hexSymbols[uint8(data[i] >> 4)];
            s[3 + i * 2] = hexSymbols[uint8(data[i] & 0x0f)];
        }
        return string(s);
    }
}
