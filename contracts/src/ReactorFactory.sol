// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";
import {ReactorToken} from "./ReactorToken.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {ReactorRouter} from "./ReactorRouter.sol";
import {ReactorLiquidityVault} from "./ReactorLiquidityVault.sol";
import {FairClaimVault} from "./FairClaimVault.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {InstantCurve} from "./InstantCurve.sol";
import {SelfBurnVault} from "./SelfBurnVault.sol";
import {FlywheelVault} from "./FlywheelVault.sol";
import {BuybackVault} from "./BuybackVault.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {LaunchPricing} from "./libraries/LaunchPricing.sol";
import {LaunchAuthorization} from "./libraries/LaunchAuthorization.sol";
import {TickerRegistry} from "./TickerRegistry.sol";
import {CurveMath} from "./libraries/CurveMath.sol";
import {IInstantLaunchModule} from "./interfaces/IInstantLaunchModule.sol";

contract ReactorFactory {

    ReactorHook public immutable hook;
    ReactorRouter public immutable router;
    ReactorLiquidityVault public immutable vault;
    FairClaimVault public immutable fairVault;
    QuoteAssetRegistry public immutable registry;
    address public immutable core;
    ReactorGuardian public immutable auth;
    TickerRegistry public immutable tickers;
    uint32 public constant FACTORY_VERSION = 1;

    InstantCurve public curve;
    IInstantLaunchModule public launchModule;
    SelfBurnVault public selfBurn;
    mapping(address => bool) public standardMode;
    bytes32 public immutable authDomain;

    uint256 public launchCount;
    mapping(address => uint32) public tokenFactoryVersion;
    mapping(address => string) public tokenTicker;

    enum LaunchMode {
        Instant,
        Fair
    }

    struct TokenInfo {
        address token;
        address quote;
        address creator;
        LaunchMode mode;
        PoolId poolId;
        bool marketLive;
        uint256 fairId;
    }

    struct FairLaunch {
        address token;
        address quote;
        address creator;
        uint64 startTime;
        uint64 endTime;
        uint16 auctionBps;
        uint256 minRaise;
        uint256 totalBids;
        uint256 auctionTokens;
        uint256 lpTokens;
        bool finalized;
        bool migrated;
        PoolId poolId;
    }

    struct TokenMeta {
        string image;
        string description;
        string website;
        string twitter;
        string telegram;
    }

    mapping(address => TokenInfo) public tokenInfo;
    mapping(uint256 => FairLaunch) public fairs;
    mapping(uint256 => mapping(address => uint256)) public bids;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(address => TokenMeta) public metadata;
    mapping(address => bool) public metaFrozen;
    address[] public allTokens;

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply);
    event LaunchCreated(address indexed token, LaunchMode mode, address indexed quote);
    event InstantMarketOpened(address indexed token, PoolId indexed poolId, uint256 fdvQuoteRaw, uint256 devBuy);
    event InstantLaunchCreated(
        address indexed token, address indexed quote, address indexed creator, bool rewards, uint256 gradTarget
    );
    event CurveBound(address curve, address selfBurn);
    event LaunchModuleBound(address indexed module);
    event BatchFairLaunchCreated(uint256 indexed fairId, address indexed token, uint64 startTime, uint64 endTime);
    event FairBid(uint256 indexed fairId, address indexed bidder, uint256 amount, uint256 totalBids);
    event BatchFairLaunchFinalized(uint256 indexed fairId, uint256 totalBids, uint256 auctionTokens);
    event OfficialPoolCreated(address indexed token, PoolId indexed poolId, LaunchMode mode);
    event MetadataSet(address indexed token, string image, string description);
    event LaunchAuthorized(address indexed token, string ticker, bytes32 authId, uint32 factoryVersion);

    error BadParams();
    error AuctionClosed();
    error AuctionOpen();
    error AlreadyFinalized();
    error AlreadyMigrated();
    error NothingToClaim();
    error AlreadyBound();
    error NotCurve();
    error CurveUnbound();
    error NeedPricingAuth();
    error ModuleUnbound();

    constructor(
        ReactorHook hook_,
        ReactorRouter router_,
        ReactorLiquidityVault vault_,
        QuoteAssetRegistry registry_,
        address core_,
        ReactorGuardian auth_,
        TickerRegistry tickers_
    ) {
        hook = hook_;
        router = router_;
        vault = vault_;
        registry = registry_;
        core = core_;
        auth = auth_;
        if (address(tickers_) == address(0)) revert BadParams();
        tickers = tickers_;
        fairVault = new FairClaimVault(address(this));
        authDomain = tickers_.domainSeparator();
    }

    function bindCurve(InstantCurve curve_, SelfBurnVault selfBurn_) external {
        if (msg.sender != auth.guardian()) revert ReactorGuardian.NotGuardian();
        if (address(curve) != address(0)) revert AlreadyBound();
        if (address(curve_) == address(0) || address(selfBurn_) == address(0)) revert BadParams();
        curve = curve_;
        selfBurn = selfBurn_;
        vault.bindCurve(address(curve_));
        curve_.bindSelfBurn(selfBurn_);
        address fw = address(hook.flywheelVault());
        if (fw != address(0)) FlywheelVault(fw).setCurve(address(curve_));
        address bb = address(hook.buybackVault());
        if (bb != address(0)) BuybackVault(bb).setCurve(address(curve_));
        emit CurveBound(address(curve_), address(selfBurn_));
    }

    function bindLaunchModule(address m) external {
        if (msg.sender != auth.guardian()) revert ReactorGuardian.NotGuardian();
        if (address(launchModule) != address(0)) revert AlreadyBound();
        if (m == address(0)) revert BadParams();
        launchModule = IInstantLaunchModule(m);
        emit LaunchModuleBound(m);
    }

    /// @notice Public wrapper so InstantLaunchModule can reuse Factory quote floors.
    function virtualQuote0Checked(address quote, uint8 qdec, LaunchAuthorization.Auth calldata a)
        external
        view
        returns (uint256)
    {
        return _virtualQuote0(quote, qdec, a);
    }

    function bindUserRouter(address exec) external {
        if (msg.sender != auth.guardian()) revert ReactorGuardian.NotGuardian();
        curve.bindRouteExecutor(exec);
    }

    function isRewards(address token) external view returns (bool) {
        return !standardMode[token];
    }

    function creditTokenRewards(address token, uint256 amount) external {
        if (msg.sender != address(curve)) revert NotCurve();
        ReactorToken(token).creditRewards(amount);
    }

    function onGraduated(address token, PoolId poolId) external {
        if (msg.sender != address(curve)) revert NotCurve();
        TokenInfo storage info = tokenInfo[token];
        if (info.token == address(0) || info.marketLive) revert BadParams();
        info.poolId = poolId;
        info.marketLive = true;
        _registerNativeQuote(token);
        emit InstantMarketOpened(token, poolId, 0, 0);
        emit OfficialPoolCreated(token, poolId, LaunchMode.Instant);
    }

    struct InstantParams {
        string name;
        string symbol;
        uint8 decimals;
        uint256 supply;
        address quote;
        uint256 fdvQuoteRaw;
        uint256 devBuyQuote;
        string image;
        string description;
        string website;
        string twitter;
        string telegram;
    }

    /// @notice Rewards Instant. Every launch needs a short-lived LaunchAuthorization (USDC included).
    function instantLaunch(InstantParams calldata p, LaunchAuthorization.Auth calldata a, bytes calldata sig)
        external
        returns (address token, PoolId poolId)
    {
        auth.requireLaunchesOpen();
        (token, poolId,) = _instantLaunch(p, true, p.devBuyQuote, 1, a, sig);
    }

    /// @notice Standard Instant (2% buy+burn). Same curve constants as Rewards.
    function launchStandard(InstantParams calldata p, LaunchAuthorization.Auth calldata a, bytes calldata sig)
        external
        returns (address token, PoolId poolId)
    {
        auth.requireLaunchesOpen();
        (token, poolId,) = _instantLaunch(p, false, p.devBuyQuote, 1, a, sig);
    }

    /// @notice Atomic create + curve init + optional creator purchase (full 3.5%). Reverts if token-out > 5%.
    function launchAndBuy(
        InstantParams calldata p,
        bool rewards,
        uint256 minOut,
        LaunchAuthorization.Auth calldata a,
        bytes calldata sig
    ) external returns (address token, PoolId poolId, uint256 tokensOut) {
        auth.requireLaunchesOpen();
        return _instantLaunch(p, rewards, p.devBuyQuote, minOut, a, sig);
    }

    function _usdPegOne(address quote) internal view returns (bool) {
        return registry.isUsdPegOne(quote);
    }

    function instantCurveConfig() public pure returns (bytes32) {
        return LaunchPricing.INSTANT_CURVE_V1;
    }

    function _instantLaunch(
        InstantParams calldata p,
        bool rewards,
        uint256 quoteIn,
        uint256 minOut,
        LaunchAuthorization.Auth memory a,
        bytes memory sig
    ) internal returns (address token, PoolId poolId, uint256 tokensOut) {
        if (address(curve) == address(0)) revert CurveUnbound();
        if (address(launchModule) == address(0)) revert ModuleUnbound();
        bytes32 digest_;
        string memory ticker;
        uint256 vq0;
        (token, digest_, ticker, vq0) =
            launchModule.createInstant(msg.sender, abi.encode(p), rewards, address(curve), a, sig);
        tickers.claimOnLaunch(ticker, token, digest_);
        tokenFactoryVersion[token] = FACTORY_VERSION;
        tokenTicker[token] = ticker;
        _setMeta(token, p.image, p.description, p.website, p.twitter, p.telegram);
        _excludeSinks(token);
        if (address(selfBurn) != address(0)) ReactorToken(token).excludeProtocol(address(selfBurn));
        ReactorToken(token).excludeProtocol(address(curve));
        emit TokenCreated(token, msg.sender, p.name, ticker, ReactorConstants.DEFAULT_SUPPLY);
        emit LaunchAuthorized(token, ticker, a.authId, FACTORY_VERSION);

        uint8 qdec = IERC20MinimalExt(p.quote).decimals();
        curve.open(token, p.quote, msg.sender, rewards, qdec, ReactorConstants.DEFAULT_SUPPLY, vq0);
        standardMode[token] = !rewards;

        tokenInfo[token] = TokenInfo({
            token: token,
            quote: p.quote,
            creator: msg.sender,
            mode: LaunchMode.Instant,
            poolId: PoolId.wrap(bytes32(0)),
            marketLive: false,
            fairId: 0
        });
        allTokens.push(token);
        emit LaunchCreated(token, LaunchMode.Instant, p.quote);
        emit InstantLaunchCreated(token, p.quote, msg.sender, rewards, 0);

        if (quoteIn > 0) {
            IERC20MinimalExt(p.quote).transferFrom(msg.sender, address(this), quoteIn);
            IERC20MinimalExt(p.quote).approve(address(curve), quoteIn);
            tokensOut = curve.launchDevBuy(token, msg.sender, quoteIn);
            IERC20MinimalExt(p.quote).approve(address(curve), 0);
            if (tokensOut < minOut) revert BadParams();
        }
        poolId = PoolId.wrap(bytes32(0));
    }

    struct FairParams {
        string name;
        string symbol;
        uint8 decimals;
        uint256 supply;
        address quote;
        uint64 duration;
        uint16 auctionBps;
        uint256 minRaise;
        string image;
        string description;
        string website;
        string twitter;
        string telegram;
    }

    function createFairLaunch(FairParams calldata p, LaunchAuthorization.Auth calldata a, bytes calldata sig)
        external
        returns (address token, uint256 fairId)
    {
        auth.requireLaunchesOpen();
        if (address(launchModule) == address(0)) revert ModuleUnbound();
        bytes32 digest_;
        string memory ticker;
        uint256 supply;
        uint64 duration;
        uint16 auctionBps;
        (token, digest_, ticker, supply, duration, auctionBps) =
            launchModule.createFair(msg.sender, abi.encode(p), a, sig);
        tickers.claimOnLaunch(ticker, token, digest_);
        tokenFactoryVersion[token] = FACTORY_VERSION;
        tokenTicker[token] = ticker;
        _setMeta(token, p.image, p.description, p.website, p.twitter, p.telegram);
        _excludeSinks(token);
        emit TokenCreated(token, msg.sender, p.name, ticker, supply);
        emit LaunchAuthorized(token, ticker, a.authId, FACTORY_VERSION);

        fairId = ++launchCount;
        uint256 auctionTokens = (supply * auctionBps) / ReactorConstants.BPS_DENOMINATOR;
        fairs[fairId] = FairLaunch({
            token: token,
            quote: p.quote,
            creator: msg.sender,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + duration),
            auctionBps: auctionBps,
            minRaise: p.minRaise,
            totalBids: 0,
            auctionTokens: auctionTokens,
            lpTokens: supply - auctionTokens,
            finalized: false,
            migrated: false,
            poolId: PoolId.wrap(bytes32(0))
        });
        tokenInfo[token] = TokenInfo({
            token: token,
            quote: p.quote,
            creator: msg.sender,
            mode: LaunchMode.Fair,
            poolId: PoolId.wrap(bytes32(0)),
            marketLive: false,
            fairId: fairId
        });
        allTokens.push(token);
        emit LaunchCreated(token, LaunchMode.Fair, p.quote);
        emit BatchFairLaunchCreated(fairId, token, uint64(block.timestamp), uint64(block.timestamp + duration));
    }

    function bid(uint256 fairId, uint256 amount) external {
        FairLaunch storage fl = fairs[fairId];
        if (fl.token == address(0)) revert BadParams();
        if (fl.finalized || block.timestamp >= fl.endTime) revert AuctionClosed();
        if (amount == 0) revert BadParams();
        IERC20MinimalExt(fl.quote).transferFrom(msg.sender, address(this), amount);
        bids[fairId][msg.sender] += amount;
        fl.totalBids += amount;
        emit FairBid(fairId, msg.sender, amount, fl.totalBids);
    }

    function finalizeFairLaunch(uint256 fairId) external returns (PoolId poolId) {
        FairLaunch storage fl = fairs[fairId];
        if (fl.token == address(0)) revert BadParams();
        if (fl.finalized) revert AlreadyFinalized();
        if (block.timestamp < fl.endTime) revert AuctionOpen();
        fl.finalized = true;
        emit BatchFairLaunchFinalized(fairId, fl.totalBids, fl.auctionTokens);

        if (fl.totalBids < fl.minRaise || fl.totalBids == 0) {
            fl.migrated = true;
            return PoolId.wrap(bytes32(0));
        }

        if (fl.migrated) revert AlreadyMigrated();
        fl.migrated = true;

        address token = fl.token;
        address quote = fl.quote;
        fairVault.pullTo(token, address(vault), fl.lpTokens);
        IERC20MinimalExt(quote).transfer(address(vault), fl.totalBids);
        poolId = launchModule.openOfficialPool(token, quote, fl.lpTokens, fl.totalBids);
        fl.poolId = poolId;

        tokenInfo[token].poolId = poolId;
        tokenInfo[token].marketLive = true;
        _registerNativeQuote(token);
        emit OfficialPoolCreated(token, poolId, LaunchMode.Fair);
    }

    function claimFairTokens(uint256 fairId, address to) external returns (uint256 amount) {
        FairLaunch storage fl = fairs[fairId];
        if (!fl.finalized) revert AuctionOpen();
        if (claimed[fairId][msg.sender]) revert NothingToClaim();
        uint256 bidAmt = bids[fairId][msg.sender];
        if (bidAmt == 0) revert NothingToClaim();
        claimed[fairId][msg.sender] = true;
        address dest = to == address(0) ? msg.sender : to;

        if (fl.totalBids == 0 || fl.totalBids < fl.minRaise) {
            IERC20MinimalExt(fl.quote).transfer(dest, bidAmt);
            return bidAmt;
        }
        amount = (bidAmt * fl.auctionTokens) / fl.totalBids;
        if (amount == 0) revert NothingToClaim();
        fairVault.settleClaim(fl.token, fl.quote, amount, dest);
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice usdPegOne uses protocol geometry (auth still required). Everyone else uses signed virtualQuote0.
    function _virtualQuote0(address quote, uint8 qdec, LaunchAuthorization.Auth memory a)
        internal
        view
        returns (uint256 virtualQuote0)
    {
        if (_usdPegOne(quote)) {
            uint256 expected = CurveMath.virtualQuote0(ReactorConstants.DEFAULT_SUPPLY, qdec);
            if (a.virtualQuote0 != 0 && a.virtualQuote0 != expected) revert LaunchAuthorization.WrongParams();
            return expected;
        }
        if (a.virtualQuote0 == 0) revert NeedPricingAuth();
        if (!registry.isEnabled(quote)) revert LaunchPricing.Quarantined();
        return a.virtualQuote0;
    }

    /// @notice Default $1-stable virtual quote₀ (decimal-scaled USDC-6 start). Not for ZEC/WBTC/native.
    function expectedVirtualQuote0(address quote) external view returns (uint256) {
        return CurveMath.virtualQuote0(ReactorConstants.DEFAULT_SUPPLY, IERC20MinimalExt(quote).decimals());
    }

    /// @notice USD-equivalent virtual quote₀. `quoteUsd6` is USDC-6 per 1 whole quote token.
    function virtualQuote0ForUsd(address quote, uint256 quoteUsd6) external view returns (uint256) {
        return
            CurveMath.virtualQuote0ForUsd(
                ReactorConstants.DEFAULT_SUPPLY, IERC20MinimalExt(quote).decimals(), quoteUsd6
            );
    }

    function _registerNativeQuote(address token) internal {
        try registry.registerNative(
            token, ReactorToken(token).symbol(), ReactorToken(token).name(), ReactorToken(token).decimals()
        ) {}
            catch {}
    }

    function isGraduatedReactor(address token) public view returns (bool) {
        TokenInfo storage info = tokenInfo[token];
        return info.token == token && info.marketLive && token != core;
    }

    function _excludeSinks(address token) internal {
        address fw = address(hook.flywheelVault());
        if (fw != address(0)) ReactorToken(token).excludeProtocol(fw);
        address bb = address(hook.buybackVault());
        if (bb != address(0)) ReactorToken(token).excludeProtocol(bb);
    }

    function _setMeta(
        address token,
        string memory image,
        string memory description,
        string memory website,
        string memory twitter,
        string memory telegram
    ) internal {
        metadata[token] = TokenMeta(image, description, website, twitter, telegram);
        metaFrozen[token] = true;
        emit MetadataSet(token, image, description);
    }
}
