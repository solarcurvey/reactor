// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {InstantCurve} from "./InstantCurve.sol";
import {RouteGuard} from "./libraries/RouteGuard.sol";
import {RouteExec} from "./libraries/RouteExec.sol";
import {ReactorConstants} from "./ReactorConstants.sol";

/// @notice Whole-route preview for user USDC paths. ONE eth_call. Always reverts with PreviewRoute.
///         Not a vault. Never maintenance minOut 0/1 as a success floor.
contract UserRouteQuoter {
    bytes32 public constant KIND_OFFICIAL = keccak256("OFFICIAL_REACTOR_V4");
    bytes32 public constant KIND_EXTERNAL = keccak256("EXTERNAL_V4_HOOKLESS");
    bytes32 public constant KIND_BONDING = keccak256("BONDING_CURVE");

    ReactorGuardian public immutable auth;
    ReactorHook public immutable hook;
    IReactorSwapper public immutable router;
    InstantCurve public immutable curve;
    address public immutable usdc;

    error PreviewRoute(uint256 amountOut, uint256[] hopOuts, bytes32[] kinds);
    error PreviewFailed();
    error Bad();

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

    /// @dev USDC → hops → quote → official/bonding. Reverts PreviewRoute. For eth_call only.
    function previewBuy(address token, uint256 usdcIn, RouteGuard.Hop[] calldata hops) external {
        if (usdcIn == 0) revert PreviewFailed();
        (address quote, bool graduated, bool bonding) = _market(token);

        uint256 nHops = hops.length + 1;
        uint256[] memory hopOuts = new uint256[](nHops);
        bytes32[] memory kinds = new bytes32[](nHops);

        uint256 quoteIn = usdcIn;
        if (quote != usdc) {
            // Execute hops in this call so intermediate quote stays on the quoter.
            // Nested try/catch preview reverts undo those balances (the old failure mode).
            // The outer eth_call still discards all state after PreviewRoute.
            RouteGuard.Hop[] memory live = hops;
            for (uint256 i; i < live.length; i++) {
                live[i].minOut = 1;
            }
            (uint256 finalOut, uint256[] memory outs) = RouteExec.runRecorded(auth, live, usdc, quote, usdcIn, 1);
            for (uint256 i; i < outs.length; i++) {
                hopOuts[i] = outs[i];
                kinds[i] = KIND_EXTERNAL;
            }
            quoteIn = finalOut;
        } else if (hops.length != 0) {
            revert Bad();
        }

        uint256 tokensOut;
        if (graduated) {
            PoolKey memory key = _official(token, quote);
            IERC20MinimalExt(quote).approve(address(router), quoteIn);
            tokensOut = router.swap(key, quote < token, -int256(quoteIn), 1, address(this));
            IERC20MinimalExt(quote).approve(address(router), 0);
            hopOuts[nHops - 1] = tokensOut;
            kinds[nHops - 1] = KIND_OFFICIAL;
        } else if (bonding) {
            IERC20MinimalExt(quote).approve(address(curve), quoteIn);
            tokensOut = curve.buy(token, quoteIn, 1);
            IERC20MinimalExt(quote).approve(address(curve), 0);
            hopOuts[nHops - 1] = tokensOut;
            kinds[nHops - 1] = KIND_BONDING;
        } else {
            revert Bad();
        }
        revert PreviewRoute(tokensOut, hopOuts, kinds);
    }

    /// @dev token → official/bonding → quote → hops → USDC. Reverts PreviewRoute. For eth_call only.
    function previewSell(address token, uint256 tokenIn, RouteGuard.Hop[] calldata hops) external {
        if (tokenIn == 0) revert PreviewFailed();
        (address quote, bool graduated, bool bonding) = _market(token);

        uint256 nHops = hops.length + 1;
        uint256[] memory hopOuts = new uint256[](nHops);
        bytes32[] memory kinds = new bytes32[](nHops);

        uint256 quoteOut;
        if (graduated) {
            PoolKey memory key = _official(token, quote);
            IERC20MinimalExt(token).approve(address(router), tokenIn);
            quoteOut = router.swap(key, token < quote, -int256(tokenIn), 1, address(this));
            IERC20MinimalExt(token).approve(address(router), 0);
            hopOuts[0] = quoteOut;
            kinds[0] = KIND_OFFICIAL;
        } else if (bonding) {
            IERC20MinimalExt(token).approve(address(curve), tokenIn);
            quoteOut = curve.sell(token, tokenIn, 1);
            IERC20MinimalExt(token).approve(address(curve), 0);
            hopOuts[0] = quoteOut;
            kinds[0] = KIND_BONDING;
        } else {
            revert Bad();
        }

        uint256 usdcOut = quoteOut;
        if (quote != usdc) {
            RouteGuard.Hop[] memory live = hops;
            for (uint256 i; i < live.length; i++) {
                live[i].minOut = 1;
            }
            (uint256 finalOut, uint256[] memory outs) = RouteExec.runRecorded(auth, live, quote, usdc, quoteOut, 1);
            for (uint256 i; i < outs.length; i++) {
                hopOuts[i + 1] = outs[i];
                kinds[i + 1] = KIND_EXTERNAL;
            }
            usdcOut = finalOut;
        } else if (hops.length != 0) {
            revert Bad();
        }
        revert PreviewRoute(usdcOut, hopOuts, kinds);
    }

    /// @dev External hop preview. Always reverts PreviewHops.
    function probeHops(RouteGuard.Hop[] memory hops, address tokenIn, address tokenOut, uint256 amountIn) external {
        RouteExec.preview(auth, hops, tokenIn, tokenOut, amountIn);
    }

    function _decodePreview(bytes memory err) internal pure returns (uint256[] memory hopOuts, uint256 finalOut) {
        if (err.length < 4) revert PreviewFailed();
        bytes4 sel;
        assembly {
            sel := mload(add(err, 32))
        }
        if (sel != RouteExec.PreviewHops.selector) revert PreviewFailed();
        bytes memory payload = new bytes(err.length - 4);
        for (uint256 i; i < payload.length; i++) {
            payload[i] = err[i + 4];
        }
        (hopOuts, finalOut) = abi.decode(payload, (uint256[], uint256));
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
}
