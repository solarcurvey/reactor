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
import {ReactorRouter} from "./ReactorRouter.sol";
import {ReactorLiquidityVault} from "./ReactorLiquidityVault.sol";
import {FairClaimVault} from "./FairClaimVault.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {LaunchMath} from "./libraries/LaunchMath.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";

contract ReactorFactory {
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    ReactorHook public immutable hook;
    ReactorRouter public immutable router;
    ReactorLiquidityVault public immutable vault;
    FairClaimVault public immutable fairVault;
    QuoteAssetRegistry public immutable registry;
    address public immutable core;

    uint256 public launchCount;

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
    event BatchFairLaunchCreated(uint256 indexed fairId, address indexed token, uint64 startTime, uint64 endTime);
    event FairBid(uint256 indexed fairId, address indexed bidder, uint256 amount, uint256 totalBids);
    event BatchFairLaunchFinalized(uint256 indexed fairId, uint256 totalBids, uint256 auctionTokens);
    event OfficialPoolCreated(address indexed token, PoolId indexed poolId, LaunchMode mode);
    event MetadataSet(address indexed token, string image, string description);

    error BadQuote();
    error BadParams();
    error NotCreator();
    error AuctionClosed();
    error AuctionOpen();
    error AlreadyFinalized();
    error AlreadyMigrated();
    error NothingToClaim();
    error CoreForbidden();
    error AuctionBpsLocked();
    error BuybackRouteRequired();
    error InstantFdvRange();
    error MetaFrozen();

    constructor(
        IPoolManager manager_,
        ReactorHook hook_,
        ReactorRouter router_,
        ReactorLiquidityVault vault_,
        QuoteAssetRegistry registry_,
        address core_
    ) {
        poolManager = manager_;
        hook = hook_;
        router = router_;
        vault = vault_;
        registry = registry_;
        core = core_;
        fairVault = new FairClaimVault(address(this));
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

    function instantLaunch(InstantParams calldata p) external returns (address token, PoolId poolId) {
        _validateLaunch(p.quote, p.supply, p.decimals, p.fdvQuoteRaw);
        uint256 supply = p.supply == 0 ? ReactorConstants.DEFAULT_SUPPLY : p.supply;
        uint8 dec = p.decimals == 0 ? ReactorConstants.DEFAULT_DECIMALS : p.decimals;
        uint256 fdv = p.fdvQuoteRaw;
        if (fdv == 0 && p.quote == registry.usdc()) fdv = ReactorConstants.INSTANT_FDV_USDC_DEFAULT;

        token = address(
            new ReactorToken(
                p.name,
                p.symbol,
                dec,
                supply,
                p.quote,
                address(hook),
                address(poolManager),
                address(vault),
                address(0),
                address(vault),
                true
            )
        );
        _setMeta(token, p.image, p.description, p.website, p.twitter, p.telegram);
        _excludeSinks(token);
        emit TokenCreated(token, msg.sender, p.name, p.symbol, supply);

        PoolKey memory key = _poolKey(token, p.quote);
        uint160 sqrtP = LaunchMath.sqrtPriceFromFdv(token, p.quote, supply, fdv);
        poolManager.initialize(key, sqrtP);
        poolId = key.toId();

        int24 startTick = TickMath.getTickAtSqrtPrice(sqrtP);
        (int24 lo, int24 hi) = LaunchMath.singleSidedRange(token, p.quote, startTick, ReactorConstants.TICK_SPACING);
        uint128 liq = LaunchMath.liquidityForSingleSided(token, p.quote, lo, hi, supply);
        vault.lockLiquidity(key, lo, hi, int256(uint256(liq)));

        tokenInfo[token] = TokenInfo({
            token: token,
            quote: p.quote,
            creator: msg.sender,
            mode: LaunchMode.Instant,
            poolId: poolId,
            marketLive: true,
            fairId: 0
        });
        allTokens.push(token);
        emit LaunchCreated(token, LaunchMode.Instant, p.quote);
        emit InstantMarketOpened(token, poolId, fdv, p.devBuyQuote);
        emit OfficialPoolCreated(token, poolId, LaunchMode.Instant);

        if (p.devBuyQuote > 0) {
            IERC20MinimalExt(p.quote).transferFrom(msg.sender, address(this), p.devBuyQuote);
            IERC20MinimalExt(p.quote).approve(address(router), p.devBuyQuote);
            bool zfo = p.quote < token;
            router.swap(key, zfo, -int256(p.devBuyQuote), 1, msg.sender);
        }
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

    function createFairLaunch(FairParams calldata p) external returns (address token, uint256 fairId) {
        if (!registry.canLaunch(p.quote)) revert BuybackRouteRequired();
        if (p.quote == core) revert CoreForbidden();
        uint256 supply = p.supply == 0 ? ReactorConstants.DEFAULT_SUPPLY : p.supply;
        uint8 dec = p.decimals == 0 ? ReactorConstants.DEFAULT_DECIMALS : p.decimals;
        uint64 duration = p.duration == 0 ? ReactorConstants.DEFAULT_FAIR_DURATION : p.duration;
        uint16 auctionBps = p.auctionBps == 0 ? ReactorConstants.DEFAULT_AUCTION_BPS : p.auctionBps;
        if (auctionBps != ReactorConstants.DEFAULT_AUCTION_BPS) revert AuctionBpsLocked();

        token = address(
            new ReactorToken(
                p.name,
                p.symbol,
                dec,
                supply,
                p.quote,
                address(hook),
                address(poolManager),
                address(vault),
                address(0),
                address(fairVault),
                false
            )
        );
        _setMeta(token, p.image, p.description, p.website, p.twitter, p.telegram);
        _excludeSinks(token);
        emit TokenCreated(token, msg.sender, p.name, p.symbol, supply);

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
        PoolKey memory key = _poolKey(token, quote);
        // Official pool opens at the auction clearing price: FDV of locked LP tokens = total bids.
        uint160 sqrtP = LaunchMath.sqrtPriceFromFdv(token, quote, fl.lpTokens, fl.totalBids);
        poolManager.initialize(key, sqrtP);
        poolId = key.toId();
        fl.poolId = poolId;

        int24 lo = TickMath.minUsableTick(ReactorConstants.TICK_SPACING);
        int24 hi = TickMath.maxUsableTick(ReactorConstants.TICK_SPACING);
        (uint160 sqrtNow,,,) = poolManager.getSlot0(poolId);
        uint256 amt0;
        uint256 amt1;
        if (token < quote) {
            amt0 = fl.lpTokens;
            amt1 = fl.totalBids;
        } else {
            amt0 = fl.totalBids;
            amt1 = fl.lpTokens;
        }
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtNow, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), amt0, amt1
        );

        fairVault.pullTo(token, address(vault), fl.lpTokens);
        IERC20MinimalExt(quote).transfer(address(vault), fl.totalBids);
        vault.lockLiquidity(key, lo, hi, int256(uint256(liq)));

        tokenInfo[token].poolId = poolId;
        tokenInfo[token].marketLive = true;
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

    function setMetadata(
        address token,
        string calldata image,
        string calldata description,
        string calldata website,
        string calldata twitter,
        string calldata telegram
    ) external {
        if (tokenInfo[token].creator != msg.sender) revert NotCreator();
        if (metaFrozen[token]) revert MetaFrozen();
        _setMeta(token, image, description, website, twitter, telegram);
        metaFrozen[token] = true;
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function _validateLaunch(address quote, uint256 supply, uint8, uint256 fdv) internal view {
        if (!registry.canLaunch(quote)) revert BuybackRouteRequired();
        if (quote == core) revert CoreForbidden();
        if (supply == 1) revert BadParams();
        address usdc = registry.usdc();
        if (quote == usdc) {
            uint256 use = fdv == 0 ? ReactorConstants.INSTANT_FDV_USDC_DEFAULT : fdv;
            if (use < ReactorConstants.INSTANT_FDV_USDC_MIN || use > ReactorConstants.INSTANT_FDV_USDC_MAX) {
                revert InstantFdvRange();
            }
        } else if (fdv == 0) {
            revert BadParams();
        }
    }

    function _poolKey(address token, address quote) internal view returns (PoolKey memory key) {
        (address a, address b) = token < quote ? (token, quote) : (quote, token);
        key = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: ReactorConstants.LP_FEE,
            tickSpacing: ReactorConstants.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
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
