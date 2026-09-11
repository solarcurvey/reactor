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
import {InstantCurve} from "./InstantCurve.sol";
import {SelfBurnVault} from "./SelfBurnVault.sol";
import {KeeperReserve} from "./KeeperReserve.sol";
import {FlywheelVault} from "./FlywheelVault.sol";

contract ReactorFactory {
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    ReactorHook public immutable hook;
    ReactorRouter public immutable router;
    ReactorLiquidityVault public immutable vault;
    FairClaimVault public immutable fairVault;
    QuoteAssetRegistry public immutable registry;
    address public immutable core;
    address public immutable configurator;

    InstantCurve public curve;
    SelfBurnVault public selfBurn;
    mapping(address => bool) public standardMode;

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
    event InstantLaunchCreated(
        address indexed token, address indexed quote, address indexed creator, bool rewards, uint256 gradTarget
    );
    event CurveBound(address curve, address selfBurn);
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
    error AlreadyBound();
    error NotCurve();
    error CurveUnbound();
    error NotConfigurator();

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
        configurator = msg.sender;
        fairVault = new FairClaimVault(address(this));
    }

    function bindCurve(InstantCurve curve_, SelfBurnVault selfBurn_, KeeperReserve keepers_) external {
        if (msg.sender != configurator) revert NotConfigurator();
        if (address(curve) != address(0)) revert AlreadyBound();
        if (address(curve_) == address(0) || address(selfBurn_) == address(0)) revert BadParams();
        curve = curve_;
        selfBurn = selfBurn_;
        vault.bindCurve(address(curve_));
        curve_.bindSelfBurn(selfBurn_, keepers_);
        address fw = address(hook.flywheelVault());
        if (fw != address(0)) FlywheelVault(fw).setCurve(address(curve_));
        emit CurveBound(address(curve_), address(selfBurn_));
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

    /// @notice Rewards Instant. Protocol owns supply/decimals/curve/FDV. Optional `devBuyQuote`.
    function instantLaunch(InstantParams calldata p) external returns (address token, PoolId poolId) {
        (token, poolId,) = _instantLaunch(p, true, p.devBuyQuote, 1);
    }

    /// @notice Standard Instant (2% buy+burn). Same curve constants as Rewards.
    function launchStandard(InstantParams calldata p) external returns (address token, PoolId poolId) {
        (token, poolId,) = _instantLaunch(p, false, p.devBuyQuote, 1);
    }

    /// @notice Atomic create + curve init + optional creator purchase (full 3.5%). Reverts if token-out > 5%.
    function launchAndBuy(InstantParams calldata p, bool rewards, uint256 minOut)
        external
        returns (address token, PoolId poolId, uint256 tokensOut)
    {
        return _instantLaunch(p, rewards, p.devBuyQuote, minOut);
    }

    function _instantLaunch(InstantParams calldata p, bool rewards, uint256 quoteIn, uint256 minOut)
        internal
        returns (address token, PoolId poolId, uint256 tokensOut)
    {
        if (address(curve) == address(0)) revert CurveUnbound();
        if (!registry.canLaunch(p.quote)) revert BuybackRouteRequired();
        if (p.quote == core) revert CoreForbidden();
        uint256 supply = ReactorConstants.DEFAULT_SUPPLY;
        uint8 dec = ReactorConstants.DEFAULT_DECIMALS;

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
                address(curve),
                true
            )
        );
        _setMeta(token, p.image, p.description, p.website, p.twitter, p.telegram);
        _excludeSinks(token);
        if (address(selfBurn) != address(0)) ReactorToken(token).excludeProtocol(address(selfBurn));
        ReactorToken(token).excludeProtocol(address(curve));
        emit TokenCreated(token, msg.sender, p.name, p.symbol, supply);

        uint8 qdec = IERC20MinimalExt(p.quote).decimals();
        curve.open(token, p.quote, msg.sender, rewards, qdec, supply);
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
            IERC20MinimalExt(p.quote).transferFrom(msg.sender, address(curve), quoteIn);
            tokensOut = curve.launchDevBuy(token, msg.sender, quoteIn);
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

    function _validateLaunch(address quote, uint256 supply, uint8, uint256) internal view {
        if (!registry.canLaunch(quote)) revert BuybackRouteRequired();
        if (quote == core) revert CoreForbidden();
        if (supply == 1) revert BadParams();
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
