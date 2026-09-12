// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {ReactorToken} from "./ReactorToken.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {ReactorLiquidityVault} from "./ReactorLiquidityVault.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {LaunchAuthorization} from "./libraries/LaunchAuthorization.sol";
import {Ticker} from "./libraries/Ticker.sol";
import {TickerRegistry} from "./TickerRegistry.sol";
import {LaunchTypes} from "./libraries/LaunchTypes.sol";
import {LaunchMath} from "./libraries/LaunchMath.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";

/// @notice Creates REACTOR-native tokens + verifies LaunchAuthorization.
/// Not a proxy. Factory still claims tickers and opens the curve (onlyFactory).
contract InstantLaunchModule {
    using StateLibrary for IPoolManager;
    uint32 public constant FACTORY_VERSION = 1;

    address public immutable factory;
    ReactorGuardian public immutable auth;
    TickerRegistry public immutable tickers;
    QuoteAssetRegistry public immutable registry;
    IPoolManager public immutable poolManager;
    ReactorHook public immutable hook;
    ReactorLiquidityVault public immutable vault;
    address public immutable core;
    address public immutable fairVault;
    bytes32 public immutable authDomain;

    error NotFactory();
    error BuybackRouteRequired();
    error CoreForbidden();
    error FactoryInactive();
    error AuctionBpsLocked();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    constructor(
        address factory_,
        ReactorGuardian auth_,
        TickerRegistry tickers_,
        QuoteAssetRegistry registry_,
        IPoolManager poolManager_,
        ReactorHook hook_,
        ReactorLiquidityVault vault_,
        address core_,
        address fairVault_,
        bytes32 authDomain_
    ) {
        factory = factory_;
        auth = auth_;
        tickers = tickers_;
        registry = registry_;
        poolManager = poolManager_;
        hook = hook_;
        vault = vault_;
        core = core_;
        fairVault = fairVault_;
        authDomain = authDomain_;
    }

    function createInstant(
        address creator,
        bytes calldata encInstant,
        bool rewards,
        address curve,
        LaunchAuthorization.Auth calldata a,
        bytes calldata sig
    ) external onlyFactory returns (address token, bytes32 digest_, string memory ticker, uint256 vq0) {
        LaunchTypes.InstantParams memory p = abi.decode(encInstant, (LaunchTypes.InstantParams));
        if (!registry.canLaunch(p.quote)) revert BuybackRouteRequired();
        if (p.quote == core) revert CoreForbidden();
        if (!tickers.isActiveFactory(factory)) revert FactoryInactive();
        ticker = Ticker.normalize(p.symbol);
        uint8 qdec = IERC20MinimalExt(p.quote).decimals();
        digest_ = LaunchAuthorization.verify(
            auth,
            authDomain,
            LaunchAuthorization.Expected({
                factory: factory,
                factoryVersion: FACTORY_VERSION,
                creator: creator,
                quote: p.quote,
                quoteDecimals: qdec,
                mode: rewards ? LaunchAuthorization.MODE_REWARDS : LaunchAuthorization.MODE_STANDARD,
                curveConfig: LaunchAuthorization.INSTANT_CURVE_V1,
                ticker: ticker,
                name: p.name,
                metadataHash: LaunchAuthorization.hashMetadata(p.image, p.description, p.website, p.twitter, p.telegram)
            }),
            a,
            sig
        );
        vq0 = IVirtualQuote(factory).virtualQuote0Checked(p.quote, qdec, a);
        token = address(
            new ReactorToken(
                p.name,
                ticker,
                ReactorConstants.DEFAULT_DECIMALS,
                ReactorConstants.DEFAULT_SUPPLY,
                p.quote,
                address(hook),
                address(poolManager),
                address(vault),
                address(0),
                curve,
                true,
                factory
            )
        );
    }

    function createFair(
        address creator,
        bytes calldata encFair,
        LaunchAuthorization.Auth calldata a,
        bytes calldata sig
    )
        external
        onlyFactory
        returns (address token, bytes32 digest_, string memory ticker, uint256 supply, uint64 duration, uint16 auctionBps)
    {
        LaunchTypes.FairParams memory p = abi.decode(encFair, (LaunchTypes.FairParams));
        if (!registry.canLaunch(p.quote)) revert BuybackRouteRequired();
        if (p.quote == core) revert CoreForbidden();
        if (!tickers.isActiveFactory(factory)) revert FactoryInactive();
        supply = p.supply == 0 ? ReactorConstants.DEFAULT_SUPPLY : p.supply;
        uint8 dec = p.decimals == 0 ? ReactorConstants.DEFAULT_DECIMALS : p.decimals;
        duration = p.duration == 0 ? ReactorConstants.DEFAULT_FAIR_DURATION : p.duration;
        auctionBps = p.auctionBps == 0 ? ReactorConstants.DEFAULT_AUCTION_BPS : p.auctionBps;
        if (auctionBps != ReactorConstants.DEFAULT_AUCTION_BPS) revert AuctionBpsLocked();
        ticker = Ticker.normalize(p.symbol);
        uint8 qdec = IERC20MinimalExt(p.quote).decimals();
        bytes32 fairCfg = LaunchAuthorization.fairCurveConfig(supply, dec, duration, auctionBps, p.minRaise);
        digest_ = LaunchAuthorization.verify(
            auth,
            authDomain,
            LaunchAuthorization.Expected({
                factory: factory,
                factoryVersion: FACTORY_VERSION,
                creator: creator,
                quote: p.quote,
                quoteDecimals: qdec,
                mode: LaunchAuthorization.MODE_FAIR,
                curveConfig: fairCfg,
                ticker: ticker,
                name: p.name,
                metadataHash: LaunchAuthorization.hashMetadata(p.image, p.description, p.website, p.twitter, p.telegram)
            }),
            a,
            sig
        );
        token = address(
            new ReactorToken(
                p.name,
                ticker,
                dec,
                supply,
                p.quote,
                address(hook),
                address(poolManager),
                address(vault),
                address(0),
                fairVault,
                false,
                factory
            )
        );
    }

    /// @notice Official v4 pool at auction clearing price. Tokens + quote must already sit on the vault.
    function openOfficialPool(address token, address quote, uint256 lpTokens, uint256 totalBids)
        external
        onlyFactory
        returns (PoolId poolId)
    {
        (address a, address b) = token < quote ? (token, quote) : (quote, token);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: ReactorConstants.LP_FEE,
            tickSpacing: ReactorConstants.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        uint160 sqrtP = LaunchMath.sqrtPriceFromFdv(token, quote, lpTokens, totalBids);
        poolManager.initialize(key, sqrtP);
        poolId = key.toId();
        int24 lo = TickMath.minUsableTick(ReactorConstants.TICK_SPACING);
        int24 hi = TickMath.maxUsableTick(ReactorConstants.TICK_SPACING);
        (uint160 sqrtNow,,,) = poolManager.getSlot0(poolId);
        uint256 amt0;
        uint256 amt1;
        if (token < quote) {
            amt0 = lpTokens;
            amt1 = totalBids;
        } else {
            amt0 = totalBids;
            amt1 = lpTokens;
        }
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtNow, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), amt0, amt1
        );
        vault.lockLiquidity(key, lo, hi, int256(uint256(liq)));
    }
}

interface IVirtualQuote {
    function virtualQuote0Checked(address quote, uint8 qdec, LaunchAuthorization.Auth calldata a)
        external
        view
        returns (uint256);
}
