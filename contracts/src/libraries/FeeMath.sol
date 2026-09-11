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
}
