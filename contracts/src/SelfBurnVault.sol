// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorToken} from "./ReactorToken.sol";
import {InstantCurve} from "./InstantCurve.sol";
import {ReactorRouter} from "./ReactorRouter.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";

/// @notice Standard-mode 2% pot. Designated Keeper market-buys and burns. Fee-exempt executor.
contract SelfBurnVault {
    ReactorGuardian public immutable auth;
    address public immutable hook;
    address public immutable factory;
    InstantCurve public immutable curve;
    ReactorRouter public immutable router;

    mapping(address => uint256) public accrued;
    mapping(address => address) public quoteOf;
    uint256 public lifetimeAccrued;
    uint256 public lifetimeBurned;
    uint256 public lock;

    event SelfBurnAccrued(address indexed token, address indexed quote, uint256 amount);
    event SelfBurnExecuted(address indexed token, uint256 quoteIn, uint256 burned);

    error NotAuth();
    error Reentrant();
    error MinOutRequired();
    error Bad();

    modifier nonReentrant() {
        if (lock == 1) revert Reentrant();
        lock = 1;
        _;
        lock = 0;
    }

    constructor(ReactorGuardian auth_, address factory_, address hook_, InstantCurve curve_, ReactorRouter router_) {
        auth = auth_;
        factory = factory_;
        hook = hook_;
        curve = curve_;
        router = router_;
    }

    function accrue(address token, address quote, uint256 amount) external {
        if (msg.sender != address(curve) && msg.sender != hook) revert NotAuth();
        if (amount == 0) return;
        accrued[token] += amount;
        quoteOf[token] = quote;
        lifetimeAccrued += amount;
        emit SelfBurnAccrued(token, quote, amount);
    }

    function execute(address token, uint256 minTargetOut) external nonReentrant {
        auth.requireKeeper(msg.sender);
        if (minTargetOut == 0) revert MinOutRequired();
        uint256 amt = accrued[token];
        address quote = quoteOf[token];
        if (quote == address(0) || amt == 0) revert Bad();
        uint256 bal = IERC20MinimalExt(quote).balanceOf(address(this));
        if (bal < amt) amt = bal;
        if (amt < ReactorConstants.DEFAULT_SETTLE_THRESHOLD) revert Bad();
        accrued[token] -= amt;
        uint256 burned;
        (address t, address q, bool live) = ReactorHook(hook).marketOfToken(token);
        if (live && t == token) {
            IERC20MinimalExt(quote).approve(address(router), amt);
            burned = router.protocolSwap(
                PoolKey({
                    currency0: Currency.wrap(token < quote ? token : quote),
                    currency1: Currency.wrap(token < quote ? quote : token),
                    fee: 0,
                    tickSpacing: 60,
                    hooks: IHooks(address(hook))
                }),
                quote < token,
                -int256(amt),
                minTargetOut,
                address(this)
            );
            IERC20MinimalExt(quote).approve(address(router), 0);
        } else {
            IERC20MinimalExt(quote).approve(address(curve), amt);
            burned = curve.buyExempt(token, amt, minTargetOut);
            IERC20MinimalExt(quote).approve(address(curve), 0);
        }
        q;
        if (burned < minTargetOut) revert MinOutRequired();
        ReactorToken(token).burn(burned);
        lifetimeBurned += burned;
        emit SelfBurnExecuted(token, amt, burned);
    }
}
