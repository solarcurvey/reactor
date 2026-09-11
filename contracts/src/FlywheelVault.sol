// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {ReactorFactory} from "./ReactorFactory.sol";
import {ReactorToken} from "./ReactorToken.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {RouteGuard} from "./libraries/RouteGuard.sol";
import {RouteExec} from "./libraries/RouteExec.sol";

/// @notice 1% quote flywheel. Designated Keeper settles to USDC and executes Top-10 buy+burn.
///         Contracts do not verify market caps. Keeper publishes epoch members + weights.
contract FlywheelVault {
    ReactorGuardian public immutable auth;
    address public immutable hook;
    address public immutable usdc;
    address public immutable core;
    IPoolManager public immutable poolManager;
    IReactorSwapper public immutable router;
    ReactorFactory public factory;
    address public curve;

    mapping(address => uint256) public quoteAccrued;
    uint256 public usdcPot;
    uint256 public epochPot;
    uint256 public lifetimeAccrued;
    uint256 public epoch;
    uint64 public epochStart;
    address[10] public ranked;
    uint256[10] public weights;
    uint256 public weightSum;
    bool public epochFinalized;
    mapping(uint256 => mapping(address => bool)) public bought;
    mapping(address => uint64) public lastSettleAt;
    uint256 public executeLock;

    event FlywheelAccrued(address indexed quote, uint256 amount);
    event QuoteSettled(address indexed quote, uint256 usdcIn);
    event EpochSubmitted(uint256 indexed epochId, uint256 n, uint256 pot);
    event Top10Buy(uint256 indexed epoch, address indexed token, uint256 usdcIn, uint256 burned);
    event EpochRolled(uint256 indexed epochId);

    error NotHook();
    error Reentrant();
    error Bad();
    error NotFactory();
    error AlreadyBound();

    modifier nonReentrant() {
        if (executeLock == 1) revert Reentrant();
        executeLock = 1;
        _;
        executeLock = 0;
    }

    modifier onlyKeeper() {
        auth.requireKeeper(msg.sender);
        _;
    }

    constructor(ReactorGuardian auth_, address hook_, address usdc_, address core_, IPoolManager pm, address router_) {
        auth = auth_;
        hook = hook_;
        usdc = usdc_;
        core = core_;
        poolManager = pm;
        router = IReactorSwapper(router_);
        epochStart = uint64(block.timestamp);
    }

    function bind(ReactorFactory factory_) external {
        if (msg.sender != auth.guardian()) revert ReactorGuardian.NotGuardian();
        if (address(factory) != address(0)) revert AlreadyBound();
        if (address(factory_) == address(0)) revert Bad();
        factory = factory_;
    }

    function setCurve(address curve_) external {
        if (msg.sender != address(factory)) revert NotFactory();
        if (curve != address(0) || curve_ == address(0)) revert Bad();
        curve = curve_;
    }

    function accrue(address quote, uint256 amount) external {
        if (msg.sender != hook && msg.sender != curve) revert NotHook();
        if (amount == 0) return;
        quoteAccrued[quote] += amount;
        lifetimeAccrued += amount;
        emit FlywheelAccrued(quote, amount);
    }

    /// @notice Keeper converts this vault's quote bucket to USDC. Hops optional when quote == USDC.
    function settleQuote(address quote, RouteGuard.Hop[] calldata hops, uint256 minOut) external onlyKeeper nonReentrant {
        if (minOut == 0 && quote != usdc) revert Bad();
        uint256 amt = quoteAccrued[quote];
        uint256 bal = IERC20MinimalExt(quote).balanceOf(address(this));
        if (bal < amt) amt = bal;
        if (amt == 0) revert Bad();
        if (lastSettleAt[quote] != 0 && block.timestamp < lastSettleAt[quote] + ReactorConstants.KEEPER_COOLDOWN) {
            revert Bad();
        }
        quoteAccrued[quote] -= amt;
        uint256 got = RouteExec.run(auth, hops, quote, usdc, amt, quote == usdc ? amt : minOut);
        usdcPot += got;
        lastSettleAt[quote] = uint64(block.timestamp);
        emit QuoteSettled(quote, got);
    }

    /// @notice Publish API-computed Top-10. Structural checks only — no mcap / oracle.
    function submitEpoch(uint256 epochId, address[] calldata targets, uint256[] calldata weights_)
        external
        onlyKeeper
        nonReentrant
    {
        if (epochFinalized) revert Bad();
        if (epochId != epoch) revert Bad();
        if (targets.length != weights_.length) revert Bad();
        if (targets.length > 10) revert Bad();

        delete ranked;
        delete weights;
        weightSum = 0;

        uint256 n = targets.length;
        uint256 sum;
        for (uint256 i; i < n; i++) {
            address token = targets[i];
            uint256 w = weights_[i];
            if (token == address(0) || token == core || w == 0) revert Bad();
            (address t,, , , , bool live,) = factory.tokenInfo(token);
            if (t != token || !live) revert Bad();
            for (uint256 j; j < i; j++) {
                if (ranked[j] == token) revert Bad();
            }
            ranked[i] = token;
            weights[i] = w;
            sum += w;
        }
        if (n >= 1 && sum != ReactorConstants.BPS_DENOMINATOR) revert Bad();
        weightSum = sum;
        epochPot = usdcPot;
        epochFinalized = true;
        emit EpochSubmitted(epochId, n, usdcPot);
    }

    function executeTop10Buyback(address token, RouteGuard.Hop[] calldata hops, uint256 minTargetOut)
        external
        onlyKeeper
        nonReentrant
    {
        if (minTargetOut == 0) revert Bad();
        if (!epochFinalized) revert Bad();
        if (token == core) revert Bad();
        if (bought[epoch][token]) revert Bad();
        uint256 w;
        bool found;
        for (uint256 i; i < 10; i++) {
            if (ranked[i] == token) {
                w = weights[i];
                found = true;
                break;
            }
        }
        if (!found || w == 0 || weightSum == 0 || usdcPot == 0 || epochPot == 0) revert Bad();
        uint256 share = (epochPot * w) / weightSum;
        if (share > usdcPot) share = usdcPot;
        if (share == 0) revert Bad();
        bought[epoch][token] = true;
        usdcPot -= share;
        uint256 burned = _buyAndBurn(token, share, hops, minTargetOut);
        emit Top10Buy(epoch, token, share, burned);
    }

    function rollEpoch() external onlyKeeper {
        if (!epochFinalized) revert Bad();
        epoch += 1;
        epochStart = uint64(block.timestamp);
        epochFinalized = false;
        epochPot = 0;
        delete ranked;
        delete weights;
        weightSum = 0;
        emit EpochRolled(epoch);
    }

    function _buyAndBurn(address token, uint256 usdcIn, RouteGuard.Hop[] memory hops, uint256 minTargetOut)
        internal
        returns (uint256 burned)
    {
        (address t, address quote, bool exists) = ReactorHook(hook).marketOfToken(token);
        if (!exists || t != token) revert Bad();
        uint256 quoteIn = usdcIn;
        if (quote != usdc) {
            uint256 hopMin = hops.length == 0 ? minTargetOut : hops[hops.length - 1].minOut;
            if (hopMin == 0) revert Bad();
            quoteIn = RouteExec.run(auth, hops, usdc, quote, usdcIn, hopMin);
        } else if (hops.length != 0) {
            revert Bad();
        }
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token < quote ? token : quote),
            currency1: Currency.wrap(token < quote ? quote : token),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        uint256 before = IERC20MinimalExt(token).balanceOf(address(this));
        IERC20MinimalExt(quote).approve(address(router), quoteIn);
        uint256 got = router.protocolSwap(key, quote < token, -int256(quoteIn), minTargetOut, address(this));
        IERC20MinimalExt(quote).approve(address(router), 0);
        burned = IERC20MinimalExt(token).balanceOf(address(this)) - before;
        if (got < minTargetOut || burned < minTargetOut) revert Bad();
        ReactorToken(token).burn(burned);
    }
}
