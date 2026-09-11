// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Immutable V1 economic constants. A different split requires a V2 deploy.
library ReactorConstants {
    uint16 internal constant BPS_DENOMINATOR = 10_000;
    uint16 internal constant PROTOCOL_FEE_BPS = 300;
    uint16 internal constant HOLDER_FEE_BPS = 200;
    uint16 internal constant BUYBACK_FEE_BPS = 100;

    uint24 internal constant LP_FEE = 0;
    int24 internal constant TICK_SPACING = 60;

    uint8 internal constant DEFAULT_DECIMALS = 18;
    uint256 internal constant DEFAULT_SUPPLY = 1_000_000_000 ether;

    uint256 internal constant REWARD_PRECISION = 1e27;

    uint64 internal constant DEFAULT_FAIR_DURATION = 45 minutes;
    uint16 internal constant DEFAULT_AUCTION_BPS = 5_000;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant DEFAULT_BUYBACK_THRESHOLD = 1e4; // 0.01 USDC-6 or tiny 18-dec
}