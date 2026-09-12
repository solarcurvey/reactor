// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";
import {LaunchAuthorization} from "../libraries/LaunchAuthorization.sol";

/// @notice Factory-bound launch module. `new ReactorToken` + EIP-712 verify live
///         here so ReactorFactory stays under EIP-170. The Factory remains the
///         only `claimOnLaunch` caller and the InstantCurve factory.
interface IInstantLaunchModule {
    function createInstant(
        address creator,
        bytes calldata encInstant,
        bool rewards,
        address curve,
        LaunchAuthorization.Auth calldata a,
        bytes calldata sig
    ) external returns (address token, bytes32 digest, string memory ticker, uint256 vq0);

    function createFair(
        address creator,
        bytes calldata encFair,
        LaunchAuthorization.Auth calldata a,
        bytes calldata sig
    )
        external
        returns (address token, bytes32 digest, string memory ticker, uint256 supply, uint64 duration, uint16 auctionBps);

    function openOfficialPool(address token, address quote, uint256 lpTokens, uint256 totalBids)
        external
        returns (PoolId poolId);
}
