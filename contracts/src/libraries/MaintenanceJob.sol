// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RouteGuard} from "./RouteGuard.sol";

/// @notice EIP-712 MaintenanceJob — short-lived authorization for AutomationGateway only.
/// Relayers deliver; they do not choose ranks, routes, or floors.
/// Digest binds gateway + chainId + action + payload + jobId + window + snapshot.
library MaintenanceJob {
    uint256 internal constant MAX_TTL = 30 minutes;

    uint8 internal constant ACTION_SELF_BURN = 0;
    uint8 internal constant ACTION_SETTLE_QUOTE = 1;
    uint8 internal constant ACTION_SUBMIT_EPOCH = 2;
    uint8 internal constant ACTION_TOP10_BUYBACK = 3;
    uint8 internal constant ACTION_ROLL_EPOCH = 4;
    uint8 internal constant ACTION_BUYBACK = 5;

    bytes32 internal constant TYPEHASH = keccak256(
        "MaintenanceJob(address gateway,uint256 chainId,uint8 action,bytes32 payloadHash,bytes32 jobId,uint256 validAfter,uint256 deadline,bytes32 snapshotHash)"
    );

    struct Job {
        address gateway;
        uint256 chainId;
        uint8 action;
        bytes32 payloadHash;
        bytes32 jobId;
        uint256 validAfter;
        uint256 deadline;
        bytes32 snapshotHash;
    }

    error Expired();
    error NotYetValid();
    error BadWindow();
    error WrongChain();
    error WrongGateway();
    error WrongAction();
    error WrongPayload();
    error WrongSnapshot();
    error BadSigner();
    error Replay();
    error ZeroJob();
    error AmountMismatch();
    error Paused();
    error UnknownAction();

    function hashHops(RouteGuard.Hop[] memory hops) internal pure returns (bytes32) {
        bytes32 acc = keccak256("REACTOR.MaintenanceHops.v1");
        for (uint256 i; i < hops.length; i++) {
            acc = keccak256(
                abi.encode(
                    acc, hops[i].adapter, hops[i].tokenIn, hops[i].tokenOut, hops[i].minOut, keccak256(hops[i].data)
                )
            );
        }
        return acc;
    }

    function selfBurnPayload(address token, uint256 amount, uint256 minTargetOut) internal pure returns (bytes32) {
        return keccak256(abi.encode(token, amount, minTargetOut));
    }

    function settlePayload(address quote, uint256 amount, uint256 minOut, bytes32 hopsHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(quote, amount, minOut, hopsHash));
    }

    function top10Payload(address token, uint256 amount, uint256 minTargetOut, bytes32 hopsHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(token, amount, minTargetOut, hopsHash));
    }

    function buybackPayload(address quote, uint256 amount, uint256 minOut, bytes32 hopsHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(quote, amount, minOut, hopsHash));
    }

    function rollPayload(uint256 epochId) internal pure returns (bytes32) {
        return keccak256(abi.encode(epochId));
    }

    /// @notice Canonical Top-10 bind. Relayers cannot substitute ranks or skip pricing-health.
    function epochSnapshotHash(
        uint256 epochId,
        address[] memory targets,
        uint256[] memory weights,
        bytes32 valuationSnapshot,
        bytes32 pricingHealthHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                epochId, keccak256(abi.encode(targets)), keccak256(abi.encode(weights)), valuationSnapshot, pricingHealthHash
            )
        );
    }

    /// @notice Signed interval must be inverted-safe and <= MAX_TTL. Then now must fall inside it.
    ///         Remaining-time-at-execution is not the TTL bound — an old validAfter + near deadline is BadWindow.
    function assertWindow(Job memory job, uint256 nowTs) internal pure {
        if (job.deadline < job.validAfter) revert BadWindow();
        if (job.deadline - job.validAfter > MAX_TTL) revert BadWindow();
        if (nowTs < job.validAfter) revert NotYetValid();
        if (nowTs > job.deadline) revert Expired();
    }

    function digest(bytes32 domainSeparator, Job memory job) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(
                    abi.encode(
                        TYPEHASH,
                        job.gateway,
                        job.chainId,
                        job.action,
                        job.payloadHash,
                        job.jobId,
                        job.validAfter,
                        job.deadline,
                        job.snapshotHash
                    )
                )
            )
        );
    }

    function recover(bytes32 digest_, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSigner();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        address signer = ecrecover(digest_, v, r, s);
        if (signer == address(0)) revert BadSigner();
        return signer;
    }
}
