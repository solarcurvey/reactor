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
import {ReactorGuardian} from "../src/ReactorGuardian.sol";
import {UniswapV4Adapter} from "../src/adapters/UniswapV4Adapter.sol";
import {RoutingRegistry} from "../src/RoutingRegistry.sol";
import {RouteGuard} from "../src/libraries/RouteGuard.sol";
import {IReactorSwapper} from "../src/interfaces/IReactorSwapper.sol";
import {LaunchPricing} from "../src/libraries/LaunchPricing.sol";
import {CurveMath} from "../src/libraries/CurveMath.sol";
import {UserRouteExecutor} from "../src/UserRouteExecutor.sol";
import {CoreVesting} from "../src/CoreVesting.sol";
import {CoreLiquidityVault} from "../src/CoreLiquidityVault.sol";
import {CoreBuybackExecutor} from "../src/CoreBuybackExecutor.sol";

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
    ReactorFactory public factory;
    InstantCurve public curve;
    SelfBurnVault public selfBurn;
    ReactorGuardian public auth;
    UniswapV4Adapter public v4Adapter;
    RoutingRegistry public routes;
    UserRouteExecutor public userRouter;
    CoreVesting public coreVesting;
    CoreLiquidityVault public coreLp;
    CoreBuybackExecutor public coreBuyback;

    address public guardian;
    address public keeper;
    uint256 internal pricingPk;
    address public pricingSigner;
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    PoolKey internal coreKey;

    function officialCoreKey() public view returns (PoolKey memory) {
        return coreKey;
    }
    PoolKey internal zecUsdcKey;
    PoolKey internal btcUsdcKey;

    function setUp() public virtual {
        guardian = address(this);
        keeper = makeAddr("keeper");
        pricingPk = 0xA11CE;
        pricingSigner = vm.addr(pricingPk);
        auth = new ReactorGuardian(guardian, keeper);
        auth.setPricingSigner(pricingSigner);

        pm = new PoolManager(address(this));
        registry = new QuoteAssetRegistry(auth);
        core = new TestCORE(address(this));
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

        vault = new ReactorLiquidityVault(pm, auth);
        router = new ReactorRouter(pm, auth);
        routes = new RoutingRegistry(auth);

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory ctor = abi.encode(pm, registry, address(core), address(vault), auth);
        (address hookAddr, bytes32 salt) = HookMiner.find(address(this), flags, type(ReactorHook).creationCode, ctor);
        hook = new ReactorHook{salt: salt}(pm, registry, address(core), address(vault), auth);
        require(address(hook) == hookAddr, "hook salt");

        coreVesting = new CoreVesting(address(core), auth, 0);
        coreLp = new CoreLiquidityVault(pm, auth, hook, address(core), address(usdc));
        hook.bindCoreVault(address(coreLp));
        core.genesis(address(coreVesting), address(coreLp));
        coreLp.initializeAndLock();
        coreVesting.activateLaunch();
        coreKey = coreLp.poolKey();

        v4Adapter = new UniswapV4Adapter(IReactorSwapper(address(router)), auth, address(hook));
        auth.setAdapter(address(v4Adapter), true);

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
        hook.bindBuyback(buyback);
        flywheel = new FlywheelVault(auth, address(hook), address(usdc), address(core), pm, address(router));
        hook.bindFlywheel(IFeeSink(address(flywheel)));

        factory = new ReactorFactory(pm, hook, router, vault, registry, address(core), auth);
        hook.bindFactory(address(factory));
        vault.bindFactory(address(factory));
        registry.bindFactory(address(factory));
        flywheel.bind(factory);
        buyback.bindFactory(address(factory));

        curve = new InstantCurve(IInstantFactory(address(factory)), hook, router, vault, registry, pm, auth);
        selfBurn = new SelfBurnVault(auth, address(factory), address(hook), curve, router);
        factory.bindCurve(curve, selfBurn);
        hook.bindCurve(address(curve));
        hook.bindSelfBurn(address(selfBurn));
        coreBuyback = new CoreBuybackExecutor(auth, hook, IReactorSwapper(address(router)), address(core), address(usdc), address(buyback));
        buyback.bindExecutor(coreBuyback);
        router.setProtocolVault(address(selfBurn), true);
        router.setProtocolVault(address(flywheel), true);
        router.setProtocolVault(address(coreBuyback), true);
        router.sealProtocolVaults();
        userRouter = new UserRouteExecutor(auth, hook, IReactorSwapper(address(router)), address(usdc));

        _seedHop(address(zec), 100_000e8, 5_000_000e6, zecUsdcKey);
        _seedHop(address(btc), 100e8, 6_000_000e6, btcUsdcKey);
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

    function _hop(address tokenIn, address tokenOut, PoolKey memory key)
        internal
        view
        returns (RouteGuard.Hop[] memory hops)
    {
        hops = new RouteGuard.Hop[](1);
        hops[0] = RouteGuard.Hop({
            adapter: address(v4Adapter), tokenIn: tokenIn, tokenOut: tokenOut, minOut: 1, data: abi.encode(key)
        });
    }

    function _twoHops(address a, address b, PoolKey memory keyAb, address c, PoolKey memory keyBc)
        internal
        view
        returns (RouteGuard.Hop[] memory hops)
    {
        hops = new RouteGuard.Hop[](2);
        hops[0] = RouteGuard.Hop({adapter: address(v4Adapter), tokenIn: a, tokenOut: b, minOut: 1, data: abi.encode(keyAb)});
        hops[1] = RouteGuard.Hop({adapter: address(v4Adapter), tokenIn: b, tokenOut: c, minOut: 1, data: abi.encode(keyBc)});
    }

    function _emptyHops() internal pure returns (RouteGuard.Hop[] memory hops) {
        hops = new RouteGuard.Hop[](0);
    }

    function _keeperSettle(address quote) internal {
        for (uint256 i; i < 48; i++) {
            uint256 acc = flywheel.quoteAccrued(quote);
            if (acc < ReactorConstants.DEFAULT_SETTLE_THRESHOLD) break;
            if (i > 0) vm.warp(block.timestamp + ReactorConstants.KEEPER_COOLDOWN);
            vm.prank(keeper);
            if (quote == address(usdc)) {
                flywheel.settleQuote(quote, _emptyHops(), 0);
            } else if (quote == address(zec)) {
                flywheel.settleQuote(quote, _hop(address(zec), address(usdc), zecUsdcKey), 1);
            } else {
                flywheel.settleQuote(quote, _hop(quote, address(usdc), btcUsdcKey), 1);
            }
        }
    }

    function _keeperCore(address quote) internal {
        vm.prank(keeper);
        if (quote == address(usdc)) {
            buyback.execute(quote, _emptyHops(), 1);
        } else if (quote == address(zec)) {
            buyback.execute(quote, _hop(address(zec), address(usdc), zecUsdcKey), 1);
        } else {
            buyback.execute(quote, _hop(quote, address(usdc), btcUsdcKey), 1);
        }
    }

    function _keeperSelfBurn(address token) internal {
        for (uint256 i; i < 48; i++) {
            uint256 acc = selfBurn.accrued(token);
            if (acc < ReactorConstants.DEFAULT_SETTLE_THRESHOLD) break;
            if (i > 0) vm.warp(block.timestamp + ReactorConstants.KEEPER_COOLDOWN);
            vm.prank(keeper);
            selfBurn.execute(token, 1);
        }
    }

    function _priceAuth(address quote) internal view returns (LaunchPricing.Auth memory a, bytes memory sig) {
        uint8 dec = IERC20Like(quote).decimals();
        uint256 vq0 = CurveMath.virtualQuote0(ReactorConstants.DEFAULT_SUPPLY, dec);
        a = LaunchPricing.Auth({
            factory: address(factory),
            quote: quote,
            quoteDecimals: dec,
            virtualQuote0: vq0,
            nonce: factory.pricingNonce(quote),
            deadline: block.timestamp + 1 hours
        });
        bytes32 digest = LaunchPricing.digest(factory.pricingDomain(), a);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pricingPk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _instantPriced(ReactorFactory.InstantParams memory p, bool rewards)
        internal
        returns (address token)
    {
        if (p.quote == address(usdc)) {
            (token,) = rewards ? factory.instantLaunch(p) : factory.launchStandard(p);
            return token;
        }
        (LaunchPricing.Auth memory a, bytes memory sig) = _priceAuth(p.quote);
        if (rewards) (token,) = factory.instantLaunchPriced(p, a, sig);
        else (token,) = factory.launchStandardPriced(p, a, sig);
    }

    function _submitTop10(address token) internal {
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        uint256 epochId = flywheel.epoch();
        vm.prank(keeper);
        flywheel.submitEpoch(epochId, t, w);
    }

    function _instantZcat(uint256 fdv) internal returns (address token) {
        token = _instantPriced(
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
            }),
            true
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
    function transfer(address, address) external returns (bool);
    function decimals() external view returns (uint8);
}

