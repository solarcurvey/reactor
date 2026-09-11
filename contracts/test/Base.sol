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
import {FlywheelVault} from "../src/FlywheelVault.sol";
import {MarketOracle} from "../src/MarketOracle.sol";
import {KeeperReserve} from "../src/KeeperReserve.sol";
import {IFeeSink} from "../src/interfaces/IFeeSink.sol";
import {QuoteAssetRegistry} from "../src/QuoteAssetRegistry.sol";
import {TestCORE} from "../src/TestCORE.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {ReactorToken} from "../src/ReactorToken.sol";
import {ReactorConstants} from "../src/ReactorConstants.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {LaunchMath} from "../src/libraries/LaunchMath.sol";
import {LiquidityAmounts} from "../src/libraries/LiquidityAmounts.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {InstantCurve, IInstantFactory} from "../src/InstantCurve.sol";
import {SelfBurnVault} from "../src/SelfBurnVault.sol";

contract Base is Test {
    using StateLibrary for PoolManager;
    using StateLibrary for IPoolManager;
    PoolManager public pm;
    QuoteAssetRegistry public registry;
    TestCORE public core;
    MockERC20 public usdc;
    MockERC20 public zec;
    MockERC20 public btc;
    ReactorLiquidityVault public vault;
    ReactorRouter public router;
    ReactorHook public hook;
    BuybackVault public buyback;
    FlywheelVault public flywheel;
    MarketOracle public oracle;
    KeeperReserve public keepers;
    ReactorFactory public factory;
    InstantCurve public curve;
    SelfBurnVault public selfBurn;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    PoolKey internal coreKey;
    PoolKey internal zecUsdcKey;
    PoolKey internal btcUsdcKey;

    function setUp() public virtual {
        pm = new PoolManager(address(this));
        registry = new QuoteAssetRegistry(address(this));
        core = new TestCORE(1_000_000_000 ether, address(this));
        usdc = new MockERC20("USD Coin", "USDC", 6, 0, address(this));
        zec = new MockERC20("Mock ZEC", "ZEC", 8, 0, address(this));
        btc = new MockERC20("Mock BTC", "BTC", 8, 0, address(this));

        usdc.mint(address(this), 1_000_000_000e6);
        zec.mint(address(this), 1_000_000e8);
        btc.mint(address(this), 21_000e8);
        usdc.mint(alice, 10_000_000e6);
        usdc.mint(bob, 10_000_000e6);
        usdc.mint(carol, 10_000_000e6);
        zec.mint(alice, 100_000e8);
        zec.mint(bob, 100_000e8);
        zec.mint(carol, 100_000e8);
        btc.mint(alice, 100e8);
        btc.mint(bob, 100e8);
        btc.mint(carol, 100e8);

        registry.setUsdc(address(usdc));
        registry.register(address(usdc), "USDC", "USD Coin", 6, "", QuoteAssetRegistry.Category.Stablecoins, address(0));
        registry.register(address(zec), "ZEC", "Mock ZEC", 8, "", QuoteAssetRegistry.Category.Crypto, address(0));
        registry.register(address(btc), "BTC", "Mock BTC", 8, "", QuoteAssetRegistry.Category.Crypto, address(0));
        registry.setBuybackRoute(address(usdc), true, false);
        registry.setBuybackRoute(address(zec), true, true);
        registry.setBuybackRoute(address(btc), true, true);

        vault = new ReactorLiquidityVault(pm);
        router = new ReactorRouter(pm);

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory ctor = abi.encode(pm, registry, address(core), address(vault), address(this));
        (address hookAddr, bytes32 salt) = HookMiner.find(address(this), flags, type(ReactorHook).creationCode, ctor);
        hook = new ReactorHook{salt: salt}(pm, registry, address(core), address(vault), address(this));
        require(address(hook) == hookAddr, "hook salt");

        buyback = new BuybackVault(
            address(core),
            address(hook),
            address(usdc),
            pm,
            address(router),
            registry,
            ReactorConstants.DEFAULT_BUYBACK_THRESHOLD
        );
        hook.bindBuyback(buyback);
        flywheel = new FlywheelVault(address(hook), address(usdc), address(core), pm, address(router));
        hook.bindFlywheel(IFeeSink(address(flywheel)));
        keepers = new KeeperReserve(address(usdc), address(this));
        keepers.setCaller(address(flywheel), true);
        keepers.setCaller(address(buyback), true);

        factory = new ReactorFactory(pm, hook, router, vault, registry, address(core));
        hook.bindFactory(address(factory));
        vault.bindFactory(address(factory));
        oracle = new MarketOracle(pm, hook, registry, address(usdc), address(core));
        flywheel.bind(factory, oracle, keepers);

        curve = new InstantCurve(IInstantFactory(address(factory)), hook, router, vault, registry, pm);
        selfBurn = new SelfBurnVault(address(factory), address(hook), curve, router);
        factory.bindCurve(curve, selfBurn, keepers);
        hook.bindCurve(address(curve));
        hook.bindSelfBurn(address(selfBurn));
        buyback.setCurve(address(curve));
        router.setProtocolVault(address(selfBurn), true);
        router.setProtocolVault(address(flywheel), true);
        router.setProtocolVault(address(buyback), true);
        keepers.setCaller(address(curve), true);

        _seedCorePool();
        _seedHop(address(zec), 100_000e8, 5_000_000e6, zecUsdcKey);
        _seedHop(address(btc), 100e8, 6_000_000e6, btcUsdcKey);
        buyback.configureHopRoute(address(zec), zecUsdcKey);
        buyback.configureHopRoute(address(btc), btcUsdcKey);
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
        _addFullRange(
            coreKey,
            address(core) < address(usdc) ? coreAmt : usdcAmt,
            address(core) < address(usdc) ? usdcAmt : coreAmt
        );
        buyback.configureCoreRoute(coreKey);
    }

    function _seedHop(address quote, uint256 quoteAmt, uint256 usdcAmt, PoolKey storage key) internal {
        address a = quote < address(usdc) ? quote : address(usdc);
        address b = quote < address(usdc) ? address(usdc) : quote;
        key.currency0 = Currency.wrap(a);
        key.currency1 = Currency.wrap(b);
        key.fee = 3000;
        key.tickSpacing = 60;
        key.hooks = IHooks(address(0));
        uint160 sqrtP = LaunchMath.encodeSqrtPriceX96(
            quote < address(usdc) ? usdcAmt : quoteAmt, quote < address(usdc) ? quoteAmt : usdcAmt
        );
        pm.initialize(key, sqrtP);
        _addFullRange(key, quote < address(usdc) ? quoteAmt : usdcAmt, quote < address(usdc) ? usdcAmt : quoteAmt);
    }

    function _addFullRange(PoolKey memory key, uint256 amt0, uint256 amt1) internal {
        int24 lo = TickMath.minUsableTick(60);
        int24 hi = TickMath.maxUsableTick(60);
        (uint160 sqrtP,,,) = _slot0(key);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), amt0, amt1
        );
        IERC20Like(Currency.unwrap(key.currency0)).approve(address(router), type(uint256).max);
        IERC20Like(Currency.unwrap(key.currency1)).approve(address(router), type(uint256).max);
        router.addLiquidity(key, lo, hi, int256(uint256(liq)));
    }

    function _slot0(PoolKey memory key)
        internal
        view
        returns (uint160 sqrtP, int24 tick, uint24 protocolFee, uint24 lpFee)
    {
        (sqrtP, tick, protocolFee, lpFee) = pm.getSlot0(key.toId());
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

    function _key(address token, address quote) internal view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(token < quote ? token : quote),
            currency1: Currency.wrap(token < quote ? quote : token),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    function _buy(address who, address token, address quote, uint256 amountIn) public returns (uint256 outAmt) {
        if (curve.existsOf(token) && !curve.graduatedOf(token)) {
            if (curve.readyOf(token)) {
                curve.graduate(token);
            } else {
                vm.prank(who);
                IERC20Like(quote).approve(address(curve), amountIn);
                vm.prank(who);
                return curve.buy(token, amountIn, 1);
            }
        }
        address c0 = token < quote ? token : quote;
        _approveRouter(who, quote, amountIn);
        vm.prank(who);
        outAmt = router.swap(_key(token, quote), quote == c0, -int256(amountIn), 1, who);
    }

    function _sell(address who, address token, address quote, uint256 amountIn) public returns (uint256 outAmt) {
        if (curve.existsOf(token) && !curve.graduatedOf(token)) {
            vm.prank(who);
            ReactorToken(token).approve(address(curve), amountIn);
            vm.prank(who);
            return curve.sell(token, amountIn, 1);
        }
        address c0 = token < quote ? token : quote;
        vm.prank(who);
        ReactorToken(token).approve(address(router), amountIn);
        vm.prank(who);
        outAmt = router.swap(_key(token, quote), token == c0, -int256(amountIn), 1, who);
    }

    function _fillAndGraduate(address who, address token) internal {
        if (!curve.existsOf(token) || curve.graduatedOf(token)) return;
        address quote = _quoteOf(token);
        for (uint256 i; i < 6 && !curve.readyOf(token); i++) {
            uint256 realQuote = curve.realQuoteOf(token);
            uint256 gradTarget = curve.gradTargetOf(token);
            if (realQuote >= gradTarget) break;
            uint256 need = gradTarget - realQuote;
            uint256 userPay = (need * 10_000) / 9_650 + need / 50 + 1;
            _bondToward(who, token, quote, userPay);
        }
        if (curve.readyOf(token) && !curve.graduatedOf(token)) {
            curve.graduate(token);
        }
    }

    function _bondToward(address who, address token, address quote, uint256 userPay) internal {
        vm.prank(who);
        IERC20Like(quote).approve(address(curve), userPay);
        vm.prank(who);
        try curve.buy(token, userPay, 1) {}
        catch {
            uint256 half = userPay / 2;
            if (half == 0) return;
            vm.prank(who);
            IERC20Like(quote).approve(address(curve), half);
            vm.prank(who);
            try curve.buy(token, half, 1) {} catch {}
        }
    }

    function _quoteOf(address token) internal view returns (address q) {
        (, q,,,,,) = factory.tokenInfo(token);
    }
}

interface IERC20Like {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}
