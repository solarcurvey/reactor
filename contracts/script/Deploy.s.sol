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
import {QuoteAssetRegistry} from "../src/QuoteAssetRegistry.sol";
import {TestCORE} from "../src/TestCORE.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {ReactorConstants} from "../src/ReactorConstants.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {LaunchMath} from "../src/libraries/LaunchMath.sol";
import {LiquidityAmounts} from "../src/libraries/LiquidityAmounts.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envOr("DEPLOYER_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        PoolManager pm = new PoolManager(deployer);
        QuoteAssetRegistry registry = new QuoteAssetRegistry(deployer);
        TestCORE core = new TestCORE(1_000_000_000 ether, deployer);
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6, 0, deployer);
        MockERC20 zec = new MockERC20("Mock ZEC", "ZEC", 8, 0, deployer);
        MockERC20 btc = new MockERC20("Mock BTC", "BTC", 8, 0, deployer);
        MockERC20 nvda = new MockERC20("Mock NVDA", "NVDA", 18, 0, deployer);

        usdc.mint(deployer, 100_000_000e6);
        zec.mint(deployer, 1_000_000e8);
        btc.mint(deployer, 21_000e8);
        nvda.mint(deployer, 1_000_000 ether);

        registry.register(address(usdc), "USDC", "USD Coin", 6, "/icons/usdc.svg", QuoteAssetRegistry.Category.Stablecoins, address(0));
        registry.register(address(zec), "ZEC", "Mock ZEC", 8, "/icons/zec.svg", QuoteAssetRegistry.Category.Crypto, address(0));
        registry.register(address(btc), "BTC", "Mock BTC", 8, "/icons/btc.svg", QuoteAssetRegistry.Category.Crypto, address(0));
        registry.register(address(nvda), "NVDA", "Mock NVDA", 18, "/icons/nvda.svg", QuoteAssetRegistry.Category.Stocks, address(0));

        ReactorLiquidityVault vault = new ReactorLiquidityVault(pm);
        ReactorRouter router = new ReactorRouter(pm);

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        // forge script {salt:} deploys via the Arachnid CREATE2 proxy, not the EOA.
        address create2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        (address hookAddr, bytes32 salt) = HookMiner.find(
            create2, flags, type(ReactorHook).creationCode, abi.encode(pm, registry, address(core), address(vault))
        );
        ReactorHook hook = new ReactorHook{salt: salt}(pm, registry, address(core), address(vault));
        require(address(hook) == hookAddr, "HOOK");

        BuybackVault buyback = new BuybackVault(
            address(core), address(hook), pm, address(router), ReactorConstants.DEFAULT_BUYBACK_THRESHOLD
        );
        hook.bindBuyback(buyback);
        ReactorFactory factory = new ReactorFactory(pm, hook, router, vault, registry, address(core));
        hook.bindFactory(address(factory));
        vault.bindFactory(address(factory));

        // CORE / USDC hookless pool
        address a = address(core) < address(usdc) ? address(core) : address(usdc);
        address b = address(core) < address(usdc) ? address(usdc) : address(core);
        PoolKey memory coreKey = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        uint256 coreAmt = 5_000_000 ether;
        uint256 usdcAmt = 5_000_000e6;
        uint160 sqrtP = LaunchMath.encodeSqrtPriceX96(
            address(core) < address(usdc) ? usdcAmt : coreAmt, address(core) < address(usdc) ? coreAmt : usdcAmt
        );
        pm.initialize(coreKey, sqrtP);
        int24 lo = TickMath.minUsableTick(60);
        int24 hi = TickMath.maxUsableTick(60);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(lo),
            TickMath.getSqrtPriceAtTick(hi),
            address(core) < address(usdc) ? coreAmt : usdcAmt,
            address(core) < address(usdc) ? usdcAmt : coreAmt
        );
        core.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        router.addLiquidity(coreKey, lo, hi, int256(uint256(liq)));
        buyback.configureRoute(coreKey);

        vm.stopBroadcast();

        console2.log("PoolManager", address(pm));
        console2.log("Registry", address(registry));
        console2.log("USDC", address(usdc));
        console2.log("ZEC", address(zec));
        console2.log("BTC", address(btc));
        console2.log("NVDA", address(nvda));
        console2.log("TestCORE", address(core));
        console2.log("Vault", address(vault));
        console2.log("Router", address(router));
        console2.log("Hook", address(hook));
        console2.log("Buyback", address(buyback));
        console2.log("Factory", address(factory));
        console2.log("HookSalt");
        console2.logBytes32(salt);
    }
}