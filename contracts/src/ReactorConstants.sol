// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Immutable V1 economic constants. A different split requires a V2 deploy.
library ReactorConstants {
    uint16 internal constant BPS_DENOMINATOR = 10_000;
    /// @dev 3.5% official REACTOR economic fee (0% native LP fee).
    uint16 internal constant PROTOCOL_FEE_BPS = 350;
    uint16 internal constant HOLDER_FEE_BPS = 200;
    uint16 internal constant FLYWHEEL_FEE_BPS = 100;
    uint16 internal constant CORE_FEE_BPS = 50;
    /// @dev Legacy alias — do not treat as CORE-only. Equals flywheel + core (1.5%).
    uint16 internal constant BUYBACK_FEE_BPS = 150;

    uint24 internal constant LP_FEE = 0;
    int24 internal constant TICK_SPACING = 60;

    uint8 internal constant DEFAULT_DECIMALS = 18;
    uint256 internal constant DEFAULT_SUPPLY = 1_000_000_000 ether;

    /// @dev Magnified dividend precision (2^128). Remainder is leftoverMagnified % eligibleSupply.
    uint256 internal constant REWARD_MAGNITUDE = 1 << 128;
    uint256 internal constant REWARD_PRECISION = REWARD_MAGNITUDE;

    uint64 internal constant DEFAULT_FAIR_DURATION = 45 minutes;
    uint16 internal constant DEFAULT_AUCTION_BPS = 5_000;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant DEFAULT_SETTLE_THRESHOLD = 1e4;

    uint16 internal constant MAX_IMPACT_BPS = 300;
    uint16 internal constant MAX_CHUNK_BPS = 2_000;
    uint16 internal constant MIN_RESERVE_BPS = 1_000;
    uint16 internal constant MAX_REF_DEV_BPS = 1_500;
    uint64 internal constant KEEPER_COOLDOWN = 5 minutes;
    uint64 internal constant EPOCH_LENGTH = 5 minutes;

    uint256 internal constant INSTANT_FDV_USDC_MIN = 10_000e6;
    uint256 internal constant INSTANT_FDV_USDC_MAX = 50_000e6;
    uint256 internal constant INSTANT_FDV_USDC_DEFAULT = 25_000e6;
    uint256 internal constant TOP10_MCAP_FLOOR_USDC = 250_000e6;

    uint256 internal constant KEEPER_BOUNTY_USDC = 1e5; // 0.10 USDC-6
    uint256 internal constant KEEPER_MAX_PER_EPOCH = 4;

    uint64 internal constant BUYBACK_COOLDOWN = KEEPER_COOLDOWN;
    uint16 internal constant BUYBACK_MAX_IMPACT_BPS = MAX_IMPACT_BPS;
    uint16 internal constant BUYBACK_MAX_CHUNK_BPS = MAX_CHUNK_BPS;
    uint16 internal constant BUYBACK_MIN_RESERVE_BPS = MIN_RESERVE_BPS;
    uint16 internal constant BUYBACK_MAX_REF_DEV_BPS = MAX_REF_DEV_BPS;
    uint256 internal constant DEFAULT_BUYBACK_THRESHOLD = DEFAULT_SETTLE_THRESHOLD;
}
