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
import {RoutingRegistry} from "../src/RoutingRegistry.sol";

contract Deploy is Script {
    struct Addresses {
        PoolManager pm;
        QuoteAssetRegistry registry;
        TestCORE core;
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
        InstantCurve curve;
        SelfBurnVault selfBurn;
        ReactorGuardian auth;
        UniswapV4Adapter v4Adapter;
        RoutingRegistry routes;
    }

    function run() external {
        uint256 pk =
            vm.envOr("DEPLOYER_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);
        address keeper = vm.envOr("KEEPER", deployer);
        address guardian = vm.envOr("GUARDIAN", deployer);
        vm.startBroadcast(pk);
        Addresses memory a = _deployCore(deployer, guardian, keeper);
        _registerQuotes(a);
        _bind(a, deployer);
        _seedRoutes(a);
        vm.stopBroadcast();
        _log(a);
    }

    function _deployCore(address deployer, address guardian, address keeper) internal returns (Addresses memory a) {
        a.auth = new ReactorGuardian(guardian, keeper);
        a.pm = new PoolManager(deployer);
        a.registry = new QuoteAssetRegistry(a.auth);
        a.core = new TestCORE(1_000_000_000 ether, deployer);
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
        a.v4Adapter = new UniswapV4Adapter(IReactorSwapper(address(a.router)));
        a.routes = new RoutingRegistry(a.auth);
    }

    function _registerQuotes(Addresses memory a) internal {
        a.registry.setUsdc(address(a.usdc));
        a.registry.register(
            address(a.usdc), "USDC", "USD Coin", 6, "/icons/usdc.svg", QuoteAssetRegistry.Category.Stablecoins, address(0)
        );
        a.registry.register(
            address(a.zec), "ZEC", "Mock ZEC", 8, "/icons/zec.svg", QuoteAssetRegistry.Category.Crypto, address(0)
        );
        a.registry.register(
            address(a.btc), "BTC", "Mock BTC", 8, "/icons/btc.svg", QuoteAssetRegistry.Category.Crypto, address(0)
        );
        a.registry.register(
            address(a.nvda), "NVDA", "Mock NVDA", 18, "/icons/nvda.svg", QuoteAssetRegistry.Category.Stocks, address(0)
        );
        a.registry.setBuybackRoute(address(a.usdc), true, false);
        a.registry.setBuybackRoute(address(a.zec), true, true);
        a.registry.setBuybackRoute(address(a.btc), true, true);
        a.auth.setAdapter(address(a.v4Adapter), true);
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
        a.flywheel = new FlywheelVault(a.auth, address(a.hook), address(a.usdc), address(a.core), a.pm, address(a.router));
        a.hook.bindFlywheel(IFeeSink(address(a.flywheel)));
        a.factory = new ReactorFactory(a.pm, a.hook, a.router, a.vault, a.registry, address(a.core), a.auth);
        a.hook.bindFactory(address(a.factory));
        a.vault.bindFactory(address(a.factory));
        a.registry.bindFactory(address(a.factory));
        a.flywheel.bind(a.factory);
        a.buyback.bindFactory(address(a.factory));
        a.curve = new InstantCurve(IInstantFactory(address(a.factory)), a.hook, a.router, a.vault, a.registry, a.pm, a.auth);
        a.selfBurn = new SelfBurnVault(a.auth, address(a.factory), address(a.hook), a.curve, a.router);
        a.factory.bindCurve(a.curve, a.selfBurn);
        a.hook.bindCurve(address(a.curve));
        a.hook.bindSelfBurn(address(a.selfBurn));
        a.router.setProtocolVault(address(a.selfBurn), true);
        a.router.setProtocolVault(address(a.flywheel), true);
        a.router.setProtocolVault(address(a.buyback), true);
        a.router.sealProtocolVaults();
    }

    function _seedRoutes(Addresses memory a) internal {
        PoolKey memory coreKey = _hookless(address(a.core), address(a.usdc));
        _seed(a.router, coreKey, address(a.core), 5_000_000 ether, address(a.usdc), 5_000_000e6);

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

    function _log(Addresses memory a) internal view {
        console2.log("Guardian", address(a.auth));
        console2.log("Keeper", a.auth.keeper());
        console2.log("PoolManager", address(a.pm));
        console2.log("Registry", address(a.registry));
        console2.log("USDC", address(a.usdc));
        console2.log("ZEC", address(a.zec));
        console2.log("BTC", address(a.btc));
        console2.log("NVDA", address(a.nvda));
        console2.log("TestCORE", address(a.core));
        console2.log("Vault", address(a.vault));
        console2.log("Router", address(a.router));
        console2.log("Hook", address(a.hook));
        console2.log("Buyback", address(a.buyback));
        console2.log("Flywheel", address(a.flywheel));
        console2.log("Factory", address(a.factory));
        console2.log("InstantCurve", address(a.curve));
        console2.log("SelfBurnVault", address(a.selfBurn));
        console2.log("V4Adapter", address(a.v4Adapter));
        console2.log("FairVault", address(a.factory.fairVault()));
    }
}
