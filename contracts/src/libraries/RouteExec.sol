// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20MinimalExt} from "../interfaces/IERC20MinimalExt.sol";
import {IRouteAdapter} from "../interfaces/IRouteAdapter.sol";
import {ReactorGuardian} from "../ReactorGuardian.sol";
import {RouteGuard} from "./RouteGuard.sol";

/// @notice Execute a validated hop list. Recipient is always the calling vault.
library RouteExec {
    error ZeroOut();
    error DeltaIn();
    error DeltaOut();

    function run(ReactorGuardian auth, RouteGuard.Hop[] memory hops, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 amountOut)
    {
        RouteGuard.validate(auth, hops, tokenIn, tokenOut);
        if (hops.length == 0) {
            if (amountIn < minOut) revert ZeroOut();
            return amountIn;
        }

        uint256 inBefore = IERC20MinimalExt(tokenIn).balanceOf(address(this));
        uint256 outBefore = IERC20MinimalExt(tokenOut).balanceOf(address(this));

        if (minOut == 0) revert ZeroOut();

        uint256 currentAmt = amountIn;
        address currentTok = tokenIn;
        for (uint256 i; i < hops.length; i++) {
            RouteGuard.Hop memory h = hops[i];
            if (h.minOut == 0) revert ZeroOut();
            uint256 hopMin = h.minOut;
            if (i == hops.length - 1 && minOut > hopMin) hopMin = minOut;

            uint256 hopInBefore = IERC20MinimalExt(h.tokenIn).balanceOf(address(this));
            uint256 hopOutBefore = IERC20MinimalExt(h.tokenOut).balanceOf(address(this));
            IERC20MinimalExt(h.tokenIn).approve(h.adapter, currentAmt);
            IRouteAdapter(h.adapter).swapExactIn(h.tokenIn, h.tokenOut, currentAmt, hopMin, address(this), h.data);
            IERC20MinimalExt(h.tokenIn).approve(h.adapter, 0);
            uint256 hopInAfter = IERC20MinimalExt(h.tokenIn).balanceOf(address(this));
            uint256 hopOutAfter = IERC20MinimalExt(h.tokenOut).balanceOf(address(this));
            if (hopInBefore < currentAmt || hopInAfter != hopInBefore - currentAmt) revert DeltaIn();
            if (hopOutAfter <= hopOutBefore) revert DeltaOut();
            uint256 actual = hopOutAfter - hopOutBefore;
            if (actual < hopMin) revert ZeroOut();
            currentAmt = actual;
            currentTok = h.tokenOut;
        }
        currentTok;

        uint256 inAfter = IERC20MinimalExt(tokenIn).balanceOf(address(this));
        uint256 outAfter = IERC20MinimalExt(tokenOut).balanceOf(address(this));
        if (inBefore < amountIn || inAfter != inBefore - amountIn) revert DeltaIn();
        if (outAfter <= outBefore) revert DeltaOut();
        amountOut = outAfter - outBefore;
        if (amountOut < minOut) revert ZeroOut();
    }
}
