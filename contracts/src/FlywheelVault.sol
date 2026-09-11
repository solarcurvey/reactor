// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";
import {IReactorToken} from "./interfaces/IReactorToken.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {ReactorFactory} from "./ReactorFactory.sol";
import {ReactorToken} from "./ReactorToken.sol";
import {MarketOracle} from "./MarketOracle.sol";
import {KeeperReserve} from "./KeeperReserve.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

/// @notice 1% quote flywheel. Async USDC pot. Top-10 buy+burn through official pools.
contract FlywheelVault {
    using StateLibrary for IPoolManager;

    address public immutable hook;
    address public immutable usdc;
    address public immutable core;
    IPoolManager public immutable poolManager;
    IReactorSwapper public immutable router;
    ReactorFactory public factory;
    MarketOracle public oracle;
    KeeperReserve public reserve;
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
    event EpochFinalized(uint256 indexed epoch, uint256 n, uint256 pot);
    event Top10Buy(uint256 indexed epoch, address indexed token, uint256 usdcIn, uint256 burned);
    event Skipped(address indexed target, string reason);

    error NotHook();
    error Reentrant();
    error Bad();

    modifier nonReentrant() {
        if (executeLock == 1) revert Reentrant();
        executeLock = 1;
        _;
        executeLock = 0;
    }

    constructor(address hook_, address usdc_, address core_, IPoolManager pm, address router_) {
        hook = hook_;
        usdc = usdc_;
        core = core_;
        poolManager = pm;
        router = IReactorSwapper(router_);
        epochStart = uint64(block.timestamp);
    }

    function bind(ReactorFactory factory_, MarketOracle oracle_, KeeperReserve reserve_) external {
        if (address(factory) != address(0)) revert Bad();
        factory = factory_;
        oracle = oracle_;
        reserve = reserve_;
    }

    function setCurve(address curve_) external {
        if (msg.sender != address(factory)) revert Bad();
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

    function settleQuote(address quote) external nonReentrant {
        uint256 amt = quoteAccrued[quote];
        uint256 bal = IERC20MinimalExt(quote).balanceOf(address(this));
        if (bal < amt) amt = bal;
        if (amt < ReactorConstants.DEFAULT_SETTLE_THRESHOLD) {
            emit Skipped(quote, "threshold");
            return;
        }
        if (lastSettleAt[quote] != 0 && block.timestamp < lastSettleAt[quote] + ReactorConstants.KEEPER_COOLDOWN) {
            emit Skipped(quote, "cooldown");
            return;
        }
        quoteAccrued[quote] -= amt;
        uint256 got;
        if (quote == usdc) {
            got = amt;
        } else {
            got = _swapToUsdc(quote, amt);
            if (got == 0) {
                quoteAccrued[quote] += amt;
                emit Skipped(quote, "route");
                return;
            }
        }
        usdcPot += got;
        lastSettleAt[quote] = uint64(block.timestamp);
        emit QuoteSettled(quote, got);
        _bounty(keccak256(abi.encode("settle", quote, epoch, got)));
    }

    function finalizeEpoch() external nonReentrant {
        if (epochFinalized) {
            emit Skipped(address(0), "finalized");
            return;
        }
        if (block.timestamp < uint256(epochStart) + ReactorConstants.EPOCH_LENGTH) {
            emit Skipped(address(0), "epoch");
            return;
        }
        delete ranked;
        delete weights;
        weightSum = 0;
        uint256 n = factory.allTokensLength();
        address[] memory cand = new address[](n);
        uint256[] memory caps = new uint256[](n);
        uint256 m;
        for (uint256 i; i < n; i++) {
            address token = factory.allTokens(i);
            if (token == core) continue;
            (uint256 mcap, bool ok) = oracle.twapMcapUsdc(token);
            if (!ok || mcap < ReactorConstants.TOP10_MCAP_FLOOR_USDC) continue;
            cand[m] = token;
            caps[m] = mcap;
            m++;
        }
        for (uint256 a; a < m; a++) {
            uint256 best = a;
            for (uint256 b = a + 1; b < m; b++) {
                if (caps[b] > caps[best]) best = b;
            }
            (cand[a], cand[best]) = (cand[best], cand[a]);
            (caps[a], caps[best]) = (caps[best], caps[a]);
        }
        uint256 filled = m > 10 ? 10 : m;
        for (uint256 i; i < filled; i++) {
            ranked[i] = cand[i];
            weights[i] = caps[i];
            weightSum += caps[i];
        }
        epochPot = usdcPot;
        epochFinalized = true;
        emit EpochFinalized(epoch, filled, usdcPot);
        _bounty(keccak256(abi.encode("finalize", epoch)));
    }

    function executeTop10Buyback(address token) external nonReentrant {
        if (!epochFinalized) {
            emit Skipped(token, "not-final");
            return;
        }
        if (token == core) {
            emit Skipped(token, "core");
            return;
        }
        if (bought[epoch][token]) {
            emit Skipped(token, "done");
            return;
        }
        uint256 w;
        bool found;
        for (uint256 i; i < 10; i++) {
            if (ranked[i] == token) {
                w = weights[i];
                found = true;
                break;
            }
        }
        if (!found || w == 0 || weightSum == 0 || usdcPot == 0) {
            emit Skipped(token, "rank");
            return;
        }
        uint256 share = (epochPot * w) / weightSum;
        if (share > usdcPot) share = usdcPot;
        if (share < ReactorConstants.DEFAULT_SETTLE_THRESHOLD) {
            emit Skipped(token, "dust");
            return;
        }
        bought[epoch][token] = true;
        usdcPot -= share;
        uint256 burned = _buyAndBurn(token, share);
        emit Top10Buy(epoch, token, share, burned);
        _bounty(keccak256(abi.encode("top10", epoch, token)));
    }

    function rollEpoch() external {
        if (!epochFinalized) revert Bad();
        if (block.timestamp < uint256(epochStart) + ReactorConstants.EPOCH_LENGTH) revert Bad();
        epoch += 1;
        epochStart = uint64(block.timestamp);
        epochFinalized = false;
        epochPot = 0;
    }

    function _buyAndBurn(address token, uint256 usdcIn) internal returns (uint256 burned) {
        (address t, address quote, bool exists) = ReactorHook(hook).marketOfToken(token);
        if (!exists || t != token) return 0;
        uint256 quoteIn = usdcIn;
        if (quote != usdc) {
            quoteIn = _swapUsdcTo(quote, usdcIn);
            if (quoteIn == 0) {
                usdcPot += usdcIn;
                return 0;
            }
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
        try router.protocolSwap(key, quote < token, -int256(quoteIn), 1, address(this)) {}
        catch {
            IERC20MinimalExt(quote).approve(address(router), 0);
            return 0;
        }
        IERC20MinimalExt(quote).approve(address(router), 0);
        burned = IERC20MinimalExt(token).balanceOf(address(this)) - before;
        if (burned > 0) {
            try ReactorToken(token).burn(burned) {}
            catch {
                IERC20MinimalExt(token).transfer(ReactorConstants.DEAD, burned);
            }
        }
    }

    function _swapToUsdc(address quote, uint256 amount) internal returns (uint256) {
        // Quote→USDC hop is the hookless 3000-bps pool seeded in tests / deploy.
        // Flywheel uses the same convention: quote < usdc sort, fee 3000, no hooks — caller must have seeded it.
        PoolKey memory hop = PoolKey({
            currency0: Currency.wrap(quote < usdc ? quote : usdc),
            currency1: Currency.wrap(quote < usdc ? usdc : quote),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        uint256 before = IERC20MinimalExt(usdc).balanceOf(address(this));
        IERC20MinimalExt(quote).approve(address(router), amount);
        try router.swap(hop, quote < usdc, -int256(amount), 1, address(this)) {}
        catch {
            IERC20MinimalExt(quote).approve(address(router), 0);
            return 0;
        }
        IERC20MinimalExt(quote).approve(address(router), 0);
        return IERC20MinimalExt(usdc).balanceOf(address(this)) - before;
    }

    function _swapUsdcTo(address quote, uint256 amount) internal returns (uint256) {
        PoolKey memory hop = PoolKey({
            currency0: Currency.wrap(quote < usdc ? quote : usdc),
            currency1: Currency.wrap(quote < usdc ? usdc : quote),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        uint256 before = IERC20MinimalExt(quote).balanceOf(address(this));
        IERC20MinimalExt(usdc).approve(address(router), amount);
        try router.swap(hop, usdc < quote, -int256(amount), 1, address(this)) {}
        catch {
            IERC20MinimalExt(usdc).approve(address(router), 0);
            return 0;
        }
        IERC20MinimalExt(usdc).approve(address(router), 0);
        return IERC20MinimalExt(quote).balanceOf(address(this)) - before;
    }

    function _bounty(bytes32 op) internal {
        if (address(reserve) == address(0)) return;
        try reserve.tryPay(op, tx.origin, uint64(epoch)) {} catch {}
    }
}
