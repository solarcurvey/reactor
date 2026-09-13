// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {AutomationGateway} from "../../src/AutomationGateway.sol";
import {MaintenanceJob} from "../../src/libraries/MaintenanceJob.sol";

/// @notice Real local-forge dual-relayer rehearsal. First valid consume wins; second is Replay.
///         Writes recorded evidence to ops/cre/simulation/failover-rehearsal.json.
///         Not a live CRE DON. Not Arc Testnet 1883. Not Arc Mainnet 5042.
contract MaintenanceFailoverTest is Base {
    AutomationGateway internal gateway;
    uint256 internal jobPk;
    address internal jobSignerAddr;
    address internal relayerA;
    address internal relayerB;

    function setUp() public override {
        super.setUp();
        jobPk = 0xB0B;
        jobSignerAddr = vm.addr(jobPk);
        relayerA = makeAddr("relayerA");
        relayerB = makeAddr("relayerB");
        gateway = new AutomationGateway(auth, jobSignerAddr, selfBurn, flywheel, buyback);
        auth.setKeeper(address(gateway));
    }

    function _sign(MaintenanceJob.Job memory job) internal view returns (bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(jobPk, MaintenanceJob.digest(gateway.domainSeparator(), job));
        return abi.encodePacked(r, s, v);
    }

    function test_dualRelayerFirstValidConsumeSecondReplayNoOp() public {
        usdc.mint(address(flywheel), 50_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 50_000e6);

        uint256 amt = flywheel.settleTake(address(usdc));
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.settlePayload(address(usdc), amt, amt, hopsH);
        MaintenanceJob.Job memory job = MaintenanceJob.Job({
            gateway: address(gateway),
            chainId: block.chainid,
            action: MaintenanceJob.ACTION_SETTLE_QUOTE,
            payloadHash: payload,
            jobId: keccak256("failover-rehearsal-settle"),
            validAfter: block.timestamp,
            deadline: block.timestamp + 15 minutes,
            snapshotHash: hopsH
        });
        bytes memory sig = _sign(job);
        bytes32 digest = MaintenanceJob.digest(gateway.domainSeparator(), job);

        uint256 potBefore = flywheel.usdcPot();
        assertEq(potBefore, 0);
        assertFalse(gateway.usedJob(job.jobId));

        vm.prank(relayerA);
        uint256 got = gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), amt);
        uint256 potAfterA = flywheel.usdcPot();
        assertGt(got, 0);
        assertEq(potAfterA, got);
        assertTrue(gateway.usedJob(job.jobId));
        assertTrue(gateway.usedDigest(digest));

        vm.prank(relayerB);
        vm.expectRevert(MaintenanceJob.Replay.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), amt);

        uint256 potAfterB = flywheel.usdcPot();
        assertEq(potAfterB, potAfterA, "second relayer must not move the pot");
        assertTrue(gateway.usedJob(job.jobId));
        assertEq(auth.keeper(), address(gateway));

        _writeEvidence(job, digest, amt, got, potBefore, potAfterA, potAfterB);
    }

    function _writeEvidence(
        MaintenanceJob.Job memory job,
        bytes32 digest,
        uint256 amount,
        uint256 usdcReceived,
        uint256 potBefore,
        uint256 potAfterA,
        uint256 potAfterB
    ) internal {
        string memory e = "failover";
        vm.serializeString(e, "kind", "local-forge-execution");
        vm.serializeString(
            e,
            "environment",
            "Foundry Test - not a live CRE DON, not Arc Testnet EIP-155 1883, not Arc Mainnet 5042"
        );
        vm.serializeString(e, "interface", "MaintenanceJob EIP-712 settleQuote");
        vm.serializeString(e, "decisionAuthority", "job signer - not CRE, not Gelato, not the relayer EOA");
        vm.serializeString(e, "ranking", "ValuationService / GET /top10 - CRE does not rank");
        vm.serializeUint(e, "chainId", block.chainid);
        vm.serializeAddress(e, "gateway", address(gateway));
        vm.serializeAddress(e, "jobSigner", jobSignerAddr);
        vm.serializeAddress(e, "relayerA", relayerA);
        vm.serializeAddress(e, "relayerB", relayerB);
        vm.serializeBytes32(e, "jobId", job.jobId);
        vm.serializeBytes32(e, "digest", digest);
        vm.serializeUint(e, "action", job.action);
        vm.serializeUint(e, "amount", amount);
        vm.serializeUint(e, "usdcReceived", usdcReceived);
        vm.serializeUint(e, "potBefore", potBefore);
        vm.serializeUint(e, "potAfterRelayerA", potAfterA);
        vm.serializeUint(e, "potAfterRelayerB", potAfterB);
        vm.serializeBool(e, "usedJobAfterFirst", true);
        vm.serializeBool(e, "usedJobAfterSecond", true);
        vm.serializeBool(e, "potUnchangedBySecond", potAfterA == potAfterB);
        vm.serializeString(e, "relayerAResult", "first valid consume - settleQuote executed");
        vm.serializeString(e, "relayerBResult", "Replay - harmless no-op, pot unchanged");
        vm.serializeString(e, "arcMainnet5042", "disabled - CRE production writes not claimed");
        vm.serializeUint(e, "blockTimestamp", block.timestamp);
        string memory json = vm.serializeString(e, "proof", "MaintenanceFailover.t.sol::test_dualRelayerFirstValidConsumeSecondReplayNoOp");
        vm.writeJson(json, "../ops/cre/simulation/failover-rehearsal.json");
    }
}
