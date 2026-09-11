// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorConstants} from "../ReactorConstants.sol";

library FeeMath {
    /// @notice Floor-split 3.5% of quote notional: 2% holders + 1% flywheel + 0.5% CORE.
    function split(uint256 quoteNotional)
        internal
        pure
        returns (uint256 holders, uint256 flywheel, uint256 coreAmt, uint256 fee)
    {
        holders = (quoteNotional * ReactorConstants.HOLDER_FEE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        flywheel = (quoteNotional * ReactorConstants.FLYWHEEL_FEE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        coreAmt = (quoteNotional * ReactorConstants.CORE_FEE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        fee = holders + flywheel + coreAmt;
    }

    /// @notice Official CORE/USDC: 0% holders + 1% flywheel + 2.5% buy+burn. Still 3.5% total.
    function splitCore(uint256 quoteNotional)
        internal
        pure
        returns (uint256 holders, uint256 flywheel, uint256 coreAmt, uint256 fee)
    {
        holders = 0;
        flywheel = (quoteNotional * ReactorConstants.FLYWHEEL_FEE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        coreAmt = (quoteNotional * ReactorConstants.CORE_MARKET_BURN_BPS) / ReactorConstants.BPS_DENOMINATOR;
        fee = flywheel + coreAmt;
    }

    function netOf(uint256 gross) internal pure returns (uint256) {
        (,,, uint256 fee) = split(gross);
        return gross - fee;
    }

    /// @notice Largest gross whose floor-split net is <= `maxNet`. Fees apply only to this gross.
    function maxGrossForNet(uint256 maxNet) internal pure returns (uint256 g) {
        if (maxNet == 0) return 0;
        g = (maxNet * ReactorConstants.BPS_DENOMINATOR) / 9_650;
        if (g < maxNet) g = maxNet;
        uint256 n = netOf(g);
        if (n > maxNet) {
            uint256 over = n - maxNet;
            g = g > over ? g - over : 0;
            n = netOf(g);
            if (n > maxNet) {
                over = n - maxNet;
                g = g > over ? g - over : 0;
            }
        } else if (n < maxNet) {
            g += (maxNet - n);
            n = netOf(g);
            if (n > maxNet) {
                uint256 over = n - maxNet;
                g = g > over ? g - over : 0;
            }
        }
    }
}
