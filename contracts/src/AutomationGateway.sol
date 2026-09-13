// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "./ReactorGuardian.sol";
import {SelfBurnVault} from "./SelfBurnVault.sol";
import {FlywheelVault} from "./FlywheelVault.sol";
import {BuybackVault} from "./BuybackVault.sol";
import {RouteGuard} from "./libraries/RouteGuard.sol";
import {MaintenanceJob} from "./libraries/MaintenanceJob.sol";

/// @notice Designated Keeper. Relayers submit short-lived signed jobs; they have no decision authority.
///         Typed vault entrypoints only — no generic `target.call(calldata)`.
///         InstantCurve.graduate is permissionless and is not a gateway job.
contract AutomationGateway {
    ReactorGuardian public immutable auth;
    SelfBurnVault public immutable selfBurn;
    FlywheelVault public immutable flywheel;
    BuybackVault public immutable buyback;
    bytes32 public immutable domainSeparator;

    address public jobSigner;
    bool public paused;
    mapping(bytes32 => bool) public usedJob;
    mapping(bytes32 => bool) public usedDigest;

    event JobSignerReplaced(address indexed previous, address indexed next);
    event GatewayPause(bool paused);
    event JobConsumed(bytes32 indexed jobId, uint8 action, address indexed relayer, bytes32 digest);

    error NotGuardian();
    error ZeroAddress();

    modifier onlyGuardian() {
        if (msg.sender != auth.guardian()) revert NotGuardian();
        _;
    }

    constructor(ReactorGuardian auth_, address jobSigner_, SelfBurnVault selfBurn_, FlywheelVault flywheel_, BuybackVault buyback_) {
        if (address(auth_) == address(0) || jobSigner_ == address(0)) revert ZeroAddress();
        if (address(selfBurn_) == address(0) || address(flywheel_) == address(0) || address(buyback_) == address(0)) {
            revert ZeroAddress();
        }
        auth = auth_;
        jobSigner = jobSigner_;
        selfBurn = selfBurn_;
        flywheel = flywheel_;
        buyback = buyback_;
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("REACTOR.AutomationGateway"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function setJobSigner(address next) external onlyGuardian {
        if (next == address(0)) revert ZeroAddress();
        emit JobSignerReplaced(jobSigner, next);
        jobSigner = next;
    }

    function pauseGateway(bool paused_) external onlyGuardian {
        paused = paused_;
        emit GatewayPause(paused_);
    }

    function jobDigest(MaintenanceJob.Job calldata job) external view returns (bytes32) {
        return MaintenanceJob.digest(domainSeparator, job);
    }

    function hopsHash(RouteGuard.Hop[] calldata hops) external pure returns (bytes32) {
        return MaintenanceJob.hashHops(hops);
    }

    function epochSnapshotHash(
        uint256 epochId,
        address[] calldata targets,
        uint256[] calldata weights,
        bytes32 valuationSnapshot,
        bytes32 pricingHealthHash
    ) external pure returns (bytes32) {
        return MaintenanceJob.epochSnapshotHash(epochId, targets, weights, valuationSnapshot, pricingHealthHash);
    }

    /// @notice SelfBurnVault.execute — amount and minTargetOut are signed; relayer cannot weaken the floor.
    function executeSelfBurn(
        MaintenanceJob.Job calldata job,
        bytes calldata sig,
        address token,
        uint256 amount,
        uint256 minTargetOut
    ) external returns (uint256 burnedAmount) {
        _consume(
            job,
            sig,
            MaintenanceJob.ACTION_SELF_BURN,
            MaintenanceJob.selfBurnPayload(token, amount, minTargetOut),
            bytes32(0)
        );
        if (selfBurn.executeTake(token) != amount) revert MaintenanceJob.AmountMismatch();
        burnedAmount = selfBurn.execute(token, minTargetOut);
    }

    /// @notice FlywheelVault.settleQuote — hops + minOut + amount are signed.
    function settleQuote(
        MaintenanceJob.Job calldata job,
        bytes calldata sig,
        address quote,
        uint256 amount,
        RouteGuard.Hop[] calldata hops,
        uint256 minOut
    ) external returns (uint256 usdcReceived) {
        bytes32 hopsH = MaintenanceJob.hashHops(hops);
        _consume(job, sig, MaintenanceJob.ACTION_SETTLE_QUOTE, MaintenanceJob.settlePayload(quote, amount, minOut, hopsH), hopsH);
        if (flywheel.settleTake(quote) != amount) revert MaintenanceJob.AmountMismatch();
        usdcReceived = flywheel.settleQuote(quote, hops, minOut);
    }

    /// @notice FlywheelVault.submitEpoch — ValuationService targets/weights + pricing-health snapshot.
    function submitEpoch(
        MaintenanceJob.Job calldata job,
        bytes calldata sig,
        uint256 epochId,
        address[] calldata targets,
        uint256[] calldata weights,
        bytes32 valuationSnapshot,
        bytes32 pricingHealthHash
    ) external {
        bytes32 snap = MaintenanceJob.epochSnapshotHash(epochId, targets, weights, valuationSnapshot, pricingHealthHash);
        _consume(job, sig, MaintenanceJob.ACTION_SUBMIT_EPOCH, snap, snap);
        flywheel.submitEpoch(epochId, targets, weights);
    }

    /// @notice FlywheelVault.executeTop10Buyback — route / minOut / share amount signed.
    function executeTop10Buyback(
        MaintenanceJob.Job calldata job,
        bytes calldata sig,
        address token,
        uint256 amount,
        RouteGuard.Hop[] calldata hops,
        uint256 minTargetOut
    ) external returns (uint256 targetBought) {
        bytes32 hopsH = MaintenanceJob.hashHops(hops);
        _consume(
            job, sig, MaintenanceJob.ACTION_TOP10_BUYBACK, MaintenanceJob.top10Payload(token, amount, minTargetOut, hopsH), hopsH
        );
        if (flywheel.top10Share(token) != amount) revert MaintenanceJob.AmountMismatch();
        targetBought = flywheel.executeTop10Buyback(token, hops, minTargetOut);
    }

    /// @notice FlywheelVault.rollEpoch — binds the finalized epoch id.
    function rollEpoch(MaintenanceJob.Job calldata job, bytes calldata sig, uint256 epochId) external {
        bytes32 payload = MaintenanceJob.rollPayload(epochId);
        _consume(job, sig, MaintenanceJob.ACTION_ROLL_EPOCH, payload, payload);
        if (flywheel.epoch() != epochId) revert MaintenanceJob.WrongPayload();
        flywheel.rollEpoch();
    }

    /// @notice BuybackVault.execute — hops + minOut + amount signed.
    function executeBuyback(
        MaintenanceJob.Job calldata job,
        bytes calldata sig,
        address quote,
        uint256 amount,
        RouteGuard.Hop[] calldata hops,
        uint256 minOut
    ) external returns (uint256 coreBought) {
        bytes32 hopsH = MaintenanceJob.hashHops(hops);
        _consume(job, sig, MaintenanceJob.ACTION_BUYBACK, MaintenanceJob.buybackPayload(quote, amount, minOut, hopsH), hopsH);
        if (buyback.executeTake(quote) != amount) revert MaintenanceJob.AmountMismatch();
        coreBought = buyback.execute(quote, hops, minOut);
    }

    /// @notice CRE / any report courier. Decodes the same typed job — never `target.call`.
    function onReport(bytes calldata, bytes calldata report) external {
        (MaintenanceJob.Job memory job, bytes memory sig, bytes memory args) =
            abi.decode(report, (MaintenanceJob.Job, bytes, bytes));
        _dispatch(job, sig, args);
    }

    function _dispatch(MaintenanceJob.Job memory job, bytes memory sig, bytes memory args) internal {
        if (job.action == MaintenanceJob.ACTION_SELF_BURN) {
            (address token, uint256 amount, uint256 minTargetOut) = abi.decode(args, (address, uint256, uint256));
            _consumeMem(
                job,
                sig,
                MaintenanceJob.ACTION_SELF_BURN,
                MaintenanceJob.selfBurnPayload(token, amount, minTargetOut),
                bytes32(0)
            );
            if (selfBurn.executeTake(token) != amount) revert MaintenanceJob.AmountMismatch();
            selfBurn.execute(token, minTargetOut);
        } else if (job.action == MaintenanceJob.ACTION_SETTLE_QUOTE) {
            (address quote, uint256 amount, RouteGuard.Hop[] memory hops, uint256 minOut) =
                abi.decode(args, (address, uint256, RouteGuard.Hop[], uint256));
            bytes32 hopsH = MaintenanceJob.hashHops(hops);
            _consumeMem(
                job, sig, MaintenanceJob.ACTION_SETTLE_QUOTE, MaintenanceJob.settlePayload(quote, amount, minOut, hopsH), hopsH
            );
            if (flywheel.settleTake(quote) != amount) revert MaintenanceJob.AmountMismatch();
            flywheel.settleQuote(quote, hops, minOut);
        } else if (job.action == MaintenanceJob.ACTION_SUBMIT_EPOCH) {
            (
                uint256 epochId,
                address[] memory targets,
                uint256[] memory weights,
                bytes32 valuationSnapshot,
                bytes32 pricingHealthHash
            ) = abi.decode(args, (uint256, address[], uint256[], bytes32, bytes32));
            bytes32 snap = MaintenanceJob.epochSnapshotHash(epochId, targets, weights, valuationSnapshot, pricingHealthHash);
            _consumeMem(job, sig, MaintenanceJob.ACTION_SUBMIT_EPOCH, snap, snap);
            flywheel.submitEpoch(epochId, targets, weights);
        } else if (job.action == MaintenanceJob.ACTION_TOP10_BUYBACK) {
            (address token, uint256 amount, RouteGuard.Hop[] memory hops, uint256 minTargetOut) =
                abi.decode(args, (address, uint256, RouteGuard.Hop[], uint256));
            bytes32 hopsH = MaintenanceJob.hashHops(hops);
            _consumeMem(
                job,
                sig,
                MaintenanceJob.ACTION_TOP10_BUYBACK,
                MaintenanceJob.top10Payload(token, amount, minTargetOut, hopsH),
                hopsH
            );
            if (flywheel.top10Share(token) != amount) revert MaintenanceJob.AmountMismatch();
            flywheel.executeTop10Buyback(token, hops, minTargetOut);
        } else if (job.action == MaintenanceJob.ACTION_ROLL_EPOCH) {
            uint256 epochId = abi.decode(args, (uint256));
            bytes32 payload = MaintenanceJob.rollPayload(epochId);
            _consumeMem(job, sig, MaintenanceJob.ACTION_ROLL_EPOCH, payload, payload);
            if (flywheel.epoch() != epochId) revert MaintenanceJob.WrongPayload();
            flywheel.rollEpoch();
        } else if (job.action == MaintenanceJob.ACTION_BUYBACK) {
            (address quote, uint256 amount, RouteGuard.Hop[] memory hops, uint256 minOut) =
                abi.decode(args, (address, uint256, RouteGuard.Hop[], uint256));
            bytes32 hopsH = MaintenanceJob.hashHops(hops);
            _consumeMem(
                job, sig, MaintenanceJob.ACTION_BUYBACK, MaintenanceJob.buybackPayload(quote, amount, minOut, hopsH), hopsH
            );
            if (buyback.executeTake(quote) != amount) revert MaintenanceJob.AmountMismatch();
            buyback.execute(quote, hops, minOut);
        } else {
            revert MaintenanceJob.UnknownAction();
        }
    }

    function _consume(
        MaintenanceJob.Job calldata job,
        bytes calldata sig,
        uint8 action,
        bytes32 payloadHash,
        bytes32 snapshotHash
    ) internal {
        _consumeMem(_copy(job), sig, action, payloadHash, snapshotHash);
    }

    function _copy(MaintenanceJob.Job calldata job) internal pure returns (MaintenanceJob.Job memory m) {
        m = MaintenanceJob.Job({
            gateway: job.gateway,
            chainId: job.chainId,
            action: job.action,
            payloadHash: job.payloadHash,
            jobId: job.jobId,
            validAfter: job.validAfter,
            deadline: job.deadline,
            snapshotHash: job.snapshotHash
        });
    }

    function _consumeMem(
        MaintenanceJob.Job memory job,
        bytes memory sig,
        uint8 action,
        bytes32 payloadHash,
        bytes32 snapshotHash
    ) internal {
        if (paused) revert MaintenanceJob.Paused();
        if (job.jobId == bytes32(0)) revert MaintenanceJob.ZeroJob();
        if (job.gateway != address(this)) revert MaintenanceJob.WrongGateway();
        if (job.chainId != block.chainid) revert MaintenanceJob.WrongChain();
        if (job.action != action) revert MaintenanceJob.WrongAction();
        if (job.payloadHash != payloadHash) revert MaintenanceJob.WrongPayload();
        if (job.snapshotHash != snapshotHash) revert MaintenanceJob.WrongSnapshot();
        MaintenanceJob.assertWindow(job, block.timestamp);
        if (usedJob[job.jobId]) revert MaintenanceJob.Replay();
        bytes32 d = MaintenanceJob.digest(domainSeparator, job);
        if (usedDigest[d]) revert MaintenanceJob.Replay();
        if (MaintenanceJob.recover(d, sig) != jobSigner) revert MaintenanceJob.BadSigner();
        usedJob[job.jobId] = true;
        usedDigest[d] = true;
        emit JobConsumed(job.jobId, action, msg.sender, d);
    }
}
