// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorConstants} from "../ReactorConstants.sol";

library FeeMath {
    /// @notice Floor-split 3% of quote notional into 2% holders + 1% buyback.
    function split(uint256 quoteNotional)
        internal
        pure
        returns (uint256 holders, uint256 buyback, uint256 fee)
    {
        holders = (quoteNotional * ReactorConstants.HOLDER_FEE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        buyback = (quoteNotional * ReactorConstants.BUYBACK_FEE_BPS) / ReactorConstants.BPS_DENOMINATOR;
        fee = holders + buyback;
    }
}