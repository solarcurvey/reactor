// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
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
import {ReactorToken} from "../src/ReactorToken.sol";
import {ReactorConstants} from "../src/ReactorConstants.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {LaunchMath} from "../src/libraries/LaunchMath.sol";
import {LiquidityAmounts} from "../src/libraries/LiquidityAmounts.sol";

contract Base is Test {
    PoolManager internal pm;
    QuoteAssetRegistry internal registry;
    TestCORE internal core;
    MockERC20 internal usdc;
    MockERC20 internal zec;
    ReactorLiquidityVault internal vault;
    ReactorRouter internal router;
    ReactorHook internal hook;
    BuybackVault internal buyback;
    ReactorFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    PoolKey internal coreKey;

    function setUp() public virtual {
        pm = new PoolManager(address(this));
        registry = new QuoteAssetRegistry(address(this));
        core = new TestCORE(1_000_000_000 ether, address(this));
        usdc = new MockERC20("USD Coin", "USDC", 6, 0, address(this));
        zec = new MockERC20("Mock ZEC", "ZEC", 8, 0, address(this));

        usdc.mint(address(this), 1_000_000_000e6);
        zec.mint(address(this), 1_000_000e8);
        usdc.mint(alice, 10_000_000e6);
        usdc.mint(bob, 10_000_000e6);
        usdc.mint(carol, 10_000_000e6);
        zec.mint(alice, 100_000e8);
        zec.mint(bob, 100_000e8);
        zec.mint(carol, 100_000e8);

        registry.register(address(usdc), "USDC", "USD Coin", 6, "", QuoteAssetRegistry.Category.Stablecoins, address(0));
        registry.register(address(zec), "ZEC", "Mock ZEC", 8, "", QuoteAssetRegistry.Category.Crypto, address(0));

        vault = new ReactorLiquidityVault(pm);
        router = new ReactorRouter(pm);

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory ctor = abi.encode(pm, registry, address(core), address(vault));
        (address hookAddr, bytes32 salt) =
            HookMiner.find(address(this), flags, type(ReactorHook).creationCode, ctor);
        hook = new ReactorHook{salt: salt}(pm, registry, address(core), address(vault));
        require(address(hook) == hookAddr, "hook salt");

        buyback = new BuybackVault(
            address(core), address(hook), pm, address(router), ReactorConstants.DEFAULT_BUYBACK_THRESHOLD
        );
        hook.bindBuyback(buyback);

        factory = new ReactorFactory(pm, hook, router, vault, registry, address(core));
        hook.bindFactory(address(factory));
        vault.bindFactory(address(factory));

        _seedCorePool();
    }

    function _seedCorePool() internal {
        address a = address(core) < address(usdc) ? address(core) : address(usdc);
        address b = address(core) < address(usdc) ? address(usdc) : address(core);
        coreKey = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        uint256 coreAmt = 10_000_000 ether;
        uint256 usdcAmt = 10_000_000e6;
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
    }

    function _instantZcat(uint256 fdv) internal returns (address token) {
        (token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "Zcash Cat",
                symbol: "ZCAT",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(zec),
                fdvQuoteRaw: fdv,
                devBuyQuote: 0,
                image: "ipfs://zcat",
                description: "A test launch token",
                website: "https://reactor.local",
                twitter: "",
                telegram: ""
            })
        );
    }

    function _approveRouter(address who, address token, uint256 amt) internal {
        vm.prank(who);
        IERC20Like(token).approve(address(router), amt);
    }
}

interface IERC20Like {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}