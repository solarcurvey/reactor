// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "../ReactorGuardian.sol";

/// @notice Structural hop checks. Does not price routes — minOut is operational risk.
library RouteGuard {
    uint256 internal constant MAX_HOPS = 3;

    struct Hop {
        address adapter;
        address tokenIn;
        address tokenOut;
        bytes data;
    }

    error BadRoute();
    error TooManyHops();
    error AdapterDenied();
    error Cycle();
    error PathMismatch();

    function validate(ReactorGuardian auth, Hop[] memory hops, address tokenIn, address tokenOut) internal view {
        uint256 n = hops.length;
        if (n > MAX_HOPS) revert TooManyHops();
        if (n == 0) {
            if (tokenIn != tokenOut) revert PathMismatch();
            return;
        }
        if (hops[0].tokenIn != tokenIn) revert PathMismatch();
        if (hops[n - 1].tokenOut != tokenOut) revert PathMismatch();

        address[4] memory seen;
        seen[0] = tokenIn;
        uint256 seenN = 1;

        for (uint256 i; i < n; i++) {
            Hop memory h = hops[i];
            if (h.adapter == address(0) || h.tokenIn == address(0) || h.tokenOut == address(0)) revert BadRoute();
            if (h.tokenIn == h.tokenOut) revert Cycle();
            if (!auth.adapterApproved(h.adapter)) revert AdapterDenied();
            if (i > 0 && h.tokenIn != hops[i - 1].tokenOut) revert PathMismatch();
            for (uint256 s; s < seenN; s++) {
                if (seen[s] == h.tokenOut) revert Cycle();
            }
            seen[seenN] = h.tokenOut;
            seenN++;
        }
    }
}
