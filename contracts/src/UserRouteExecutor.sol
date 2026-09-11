// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {ReactorRouter} from "./ReactorRouter.sol";
import {InstantCurve} from "./InstantCurve.sol";
import {RouteGuard} from "./libraries/RouteGuard.sol";
import {RouteExec} from "./libraries/RouteExec.sol";
import {ReactorConstants} from "./ReactorConstants.sol";

/// @notice User USDC ↔ token router. Bonding and graduated share this path.
///         Separate from protocol vaults. Never uses ProtocolV4Adapter. Fees apply.
contract UserRouteExecutor {
    ReactorGuardian public immutable auth;
    ReactorHook public immutable hook;
    IReactorSwapper public immutable router;
    InstantCurve public immutable curve;
    address public immutable usdc;

    error Expired();
    error Bad();
    error VaultForbidden();
    error MinOutRequired();

    constructor(
        ReactorGuardian auth_,
        ReactorHook hook_,
        IReactorSwapper router_,
        InstantCurve curve_,
        address usdc_
    ) {
        auth = auth_;
        hook = hook_;
        router = router_;
        curve = curve_;
        usdc = usdc_;
    }

    /// @notice USDC → optional hops → quote → official pool or bonding curve → token.
    function buy(
        address token,
        uint256 usdcIn,
        RouteGuard.Hop[] calldata hops,
        uint256 minFinalOut,
        uint256 deadline
    ) external returns (uint256 tokensOut) {
        if (block.timestamp > deadline) revert Expired();
        if (minFinalOut == 0 || usdcIn == 0) revert MinOutRequired();
        _assertNotVault(msg.sender);
        (address quote, bool graduated, bool bonding) = _market(token);

        IERC20MinimalExt(usdc).transferFrom(msg.sender, address(this), usdcIn);
        uint256 quoteIn = usdcIn;
        if (quote != usdc) {
            quoteIn =
                RouteExec.run(auth, hops, usdc, quote, usdcIn, hops.length == 0 ? minFinalOut : hops[hops.length - 1].minOut);
        } else if (hops.length != 0) {
            revert Bad();
        }

        if (graduated) {
            PoolKey memory key = _official(token, quote);
            IERC20MinimalExt(quote).approve(address(router), quoteIn);
            tokensOut = router.swap(key, quote < token, -int256(quoteIn), minFinalOut, msg.sender);
            IERC20MinimalExt(quote).approve(address(router), 0);
        } else if (bonding) {
            IERC20MinimalExt(quote).transfer(address(curve), quoteIn);
            tokensOut = curve.buyPrefunded(token, msg.sender, quoteIn, minFinalOut);
        } else {
            revert Bad();
        }
        if (tokensOut < minFinalOut) revert MinOutRequired();
    }

    /// @notice token → official pool or bonding curve → quote → optional hops → USDC.
    /// @param minQuoteOut Floor on the first-leg (quote units). Not a 1-wei protocol default.
    /// @param minFinalOut Floor on the USDC exit. Intermediate hop floors are caller-supplied on `hops`.
    function sell(
        address token,
        uint256 tokenIn,
        RouteGuard.Hop[] calldata hops,
        uint256 minQuoteOut,
        uint256 minFinalOut,
        uint256 deadline
    ) external returns (uint256 usdcOut) {
        if (block.timestamp > deadline) revert Expired();
        if (minFinalOut == 0 || minQuoteOut == 0 || tokenIn == 0) revert MinOutRequired();
        _assertNotVault(msg.sender);
        (address quote, bool graduated, bool bonding) = _market(token);

        IERC20MinimalExt(token).transferFrom(msg.sender, address(this), tokenIn);
        uint256 quoteOut;
        if (graduated) {
            PoolKey memory key = _official(token, quote);
            IERC20MinimalExt(token).approve(address(router), tokenIn);
            quoteOut = router.swap(key, token < quote, -int256(tokenIn), minQuoteOut, address(this));
            IERC20MinimalExt(token).approve(address(router), 0);
        } else if (bonding) {
            IERC20MinimalExt(token).approve(address(curve), tokenIn);
            quoteOut = curve.sell(token, tokenIn, minQuoteOut);
            IERC20MinimalExt(token).approve(address(curve), 0);
        } else {
            revert Bad();
        }

        if (quote == usdc) {
            if (hops.length != 0) revert Bad();
            if (quoteOut < minFinalOut) revert MinOutRequired();
            IERC20MinimalExt(usdc).transfer(msg.sender, quoteOut);
            return quoteOut;
        }
        usdcOut = RouteExec.run(auth, hops, quote, usdc, quoteOut, minFinalOut);
        IERC20MinimalExt(usdc).transfer(msg.sender, usdcOut);
    }

    function _market(address token) internal view returns (address quote, bool graduated, bool bonding) {
        (address t, address q, bool live) = hook.marketOfToken(token);
        if (live && t == token) return (q, true, false);
        if (curve.existsOf(token) && !curve.graduatedOf(token) && !curve.readyOf(token)) {
            return (curve.quoteOf(token), false, true);
        }
        revert Bad();
    }

    function _official(address token, address quote) internal view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(token < quote ? token : quote),
            currency1: Currency.wrap(token < quote ? quote : token),
            fee: ReactorConstants.LP_FEE,
            tickSpacing: ReactorConstants.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    function _assertNotVault(address who) internal view {
        if (ReactorRouter(address(router)).protocolVault(who)) revert VaultForbidden();
        if (ReactorRouter(address(router)).protocolVault(address(this))) revert VaultForbidden();
    }
}
