// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {ReactorConstants} from "../ReactorConstants.sol";

/// @notice Constant-product virtual-reserve math. Clean-room; see CURVE_DESIGN.md.
library CurveMath {
    function inventories(uint256 supply) internal pure returns (uint256 curveInv, uint256 lpReserve) {
        curveInv = (supply * ReactorConstants.CURVE_INVENTORY_BPS) / ReactorConstants.BPS_DENOMINATOR;
        lpReserve = supply - curveInv;
    }

    function virtualOffset(uint256 curveInv, uint256 lpReserve) internal pure returns (uint256) {
        return FullMath.mulDiv(curveInv, lpReserve, curveInv - lpReserve);
    }

    function virtualToken0(uint256 supply) internal pure returns (uint256) {
        (uint256 curveInv, uint256 lpReserve) = inventories(supply);
        return curveInv + virtualOffset(curveInv, lpReserve);
    }

    /// @notice Virtual quote₀ in `quoteDecimals`, calibrated to USDC-6 start FDV.
    function virtualQuote0(uint256 supply, uint8 quoteDecimals) internal pure returns (uint256 q0) {
        uint256 vt0 = virtualToken0(supply);
        uint256 qUsdc = FullMath.mulDiv(ReactorConstants.INSTANT_START_FDV_USDC, vt0, supply);
        if (quoteDecimals == 6) return qUsdc;
        if (quoteDecimals > 6) return qUsdc * (10 ** (quoteDecimals - 6));
        return qUsdc / (10 ** (6 - quoteDecimals));
    }

    function gradTarget(uint256 q0, uint256 curveInv, uint256 vOff) internal pure returns (uint256) {
        return FullMath.mulDiv(q0, curveInv, vOff);
    }

    function buyOut(uint256 virtualQuote, uint256 virtualToken, uint256 quoteIn)
        internal
        pure
        returns (uint256 tokensOut, uint256 newQ, uint256 newT)
    {
        if (quoteIn == 0 || virtualQuote == 0 || virtualToken == 0) return (0, virtualQuote, virtualToken);
        newQ = virtualQuote + quoteIn;
        newT = FullMath.mulDiv(virtualQuote, virtualToken, newQ);
        tokensOut = virtualToken - newT;
    }

    function sellOut(uint256 virtualQuote, uint256 virtualToken, uint256 tokenIn)
        internal
        pure
        returns (uint256 quoteOut, uint256 newQ, uint256 newT)
    {
        if (tokenIn == 0 || virtualQuote == 0 || virtualToken == 0) return (0, virtualQuote, virtualToken);
        newT = virtualToken + tokenIn;
        newQ = FullMath.mulDiv(virtualQuote, virtualToken, newT);
        quoteOut = virtualQuote - newQ;
    }

    function quoteInForTokens(uint256 virtualQuote, uint256 virtualToken, uint256 tokensOut)
        internal
        pure
        returns (uint256 quoteIn)
    {
        if (tokensOut == 0 || tokensOut >= virtualToken) return type(uint256).max;
        uint256 newT = virtualToken - tokensOut;
        uint256 newQ = FullMath.mulDiv(virtualQuote, virtualToken, newT);
        if (newQ <= virtualQuote) return 0;
        return newQ - virtualQuote;
    }
}
