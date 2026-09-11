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

        uint256 currentAmt = amountIn;
        address currentTok = tokenIn;
        for (uint256 i; i < hops.length; i++) {
            RouteGuard.Hop memory h = hops[i];
            uint256 hopMin = i == hops.length - 1 ? minOut : 1;
            IERC20MinimalExt(h.tokenIn).approve(h.adapter, currentAmt);
            uint256 got = IRouteAdapter(h.adapter).swapExactIn(h.tokenIn, h.tokenOut, currentAmt, hopMin, address(this), h.data);
            IERC20MinimalExt(h.tokenIn).approve(h.adapter, 0);
            currentAmt = got;
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
