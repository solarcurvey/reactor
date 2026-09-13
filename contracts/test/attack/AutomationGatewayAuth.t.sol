// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {AutomationGateway} from "../../src/AutomationGateway.sol";
import {MaintenanceJob} from "../../src/libraries/MaintenanceJob.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";

/// @notice Compromised relayer / CRE courier cannot steer ranks, routes, or floors.
contract AutomationGatewayAuthTest is Base {
    AutomationGateway internal gateway;
    uint256 internal jobPk;
    address internal jobSignerAddr;
    address internal relayer;
    address internal attacker;

    function setUp() public override {
        super.setUp();
        jobPk = 0xB0B;
        jobSignerAddr = vm.addr(jobPk);
        relayer = makeAddr("relayer");
        attacker = makeAddr("attacker");
        gateway = new AutomationGateway(auth, jobSignerAddr, selfBurn, flywheel, buyback);
        auth.setKeeper(address(gateway));
    }

    function _sign(MaintenanceJob.Job memory job) internal view returns (bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(jobPk, MaintenanceJob.digest(gateway.domainSeparator(), job));
        return abi.encodePacked(r, s, v);
    }

    function _signPk(uint256 pk, MaintenanceJob.Job memory job) internal view returns (bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MaintenanceJob.digest(gateway.domainSeparator(), job));
        return abi.encodePacked(r, s, v);
    }

    function _job(uint8 action, bytes32 payload, bytes32 snap, bytes32 jobId)
        internal
        view
        returns (MaintenanceJob.Job memory job)
    {
        return MaintenanceJob.Job({
            gateway: address(gateway),
            chainId: block.chainid,
            action: action,
            payloadHash: payload,
            jobId: jobId,
            validAfter: block.timestamp,
            deadline: block.timestamp + 15 minutes,
            snapshotHash: snap
        });
    }

    function _seedUsdcPot() internal {
        usdc.mint(address(flywheel), 50_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 50_000e6);
    }

    function _settleJob(uint256 minOut) internal view returns (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) {
        amt = flywheel.settleTake(address(usdc));
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.settlePayload(address(usdc), amt, minOut, hopsH);
        job = _job(MaintenanceJob.ACTION_SETTLE_QUOTE, payload, hopsH, keccak256("settle-auth"));
        sig = _sign(job);
    }

    function test_wrongChainReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt,) = _settleJob(1);
        job.chainId = 999;
        bytes memory sig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.WrongChain.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_wrongGatewayReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, ) = _settleJob(1);
        job.gateway = attacker;
        bytes memory sig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.WrongGateway.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_tamperedMinOutReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) = _settleJob(100);
        vm.prank(attacker);
        vm.expectRevert(MaintenanceJob.WrongPayload.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_tamperedHopsReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) = _settleJob(1);
        RouteGuard.Hop[] memory hops = _protocolHop(address(usdc), address(usdc), zecUsdcKey);
        hops[0].minOut = 1;
        vm.prank(attacker);
        vm.expectRevert(MaintenanceJob.WrongPayload.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, hops, 1);
    }

    function test_expiredJobReverts() public {
        vm.warp(block.timestamp + 1 hours);
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt,) = _settleJob(1);
        job.validAfter = block.timestamp - 10 minutes;
        job.deadline = block.timestamp - 1;
        bytes memory sig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.Expired.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_notYetValidReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt,) = _settleJob(1);
        job.validAfter = block.timestamp + 1 hours;
        job.deadline = block.timestamp + 1 hours + 10 minutes;
        bytes memory lateSig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.NotYetValid.selector);
        gateway.settleQuote(job, lateSig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_ttlTooLongReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt,) = _settleJob(1);
        job.deadline = block.timestamp + MaintenanceJob.MAX_TTL + 1;
        bytes memory longSig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.BadWindow.selector);
        gateway.settleQuote(job, longSig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_invertedWindowReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt,) = _settleJob(1);
        job.validAfter = block.timestamp + 10 minutes;
        job.deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.BadWindow.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_staleValidAfterNearDeadlineCannotExecute() public {
        vm.warp(block.timestamp + 30 days);
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt,) = _settleJob(1);
        job.validAfter = block.timestamp - 30 days;
        job.deadline = block.timestamp + 5 minutes;
        bytes memory leaked = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.BadWindow.selector);
        gateway.settleQuote(job, leaked, address(usdc), amt, _emptyHops(), 1);
        assertFalse(gateway.usedJob(job.jobId));
        assertEq(flywheel.usdcPot(), 0);
    }

    function test_scheduledShortWindowExecutesAfterWarp() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt,) = _settleJob(1);
        job.validAfter = block.timestamp + 1 hours;
        job.deadline = block.timestamp + 1 hours + 10 minutes;
        bytes memory sig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.NotYetValid.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);

        vm.warp(job.validAfter);
        vm.prank(relayer);
        uint256 got = gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
        assertGt(got, 0);
        assertTrue(gateway.usedJob(job.jobId));
    }

    function test_replayAndDualRelayerRace() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) = _settleJob(1);
        vm.prank(relayer);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
        uint256 pot = flywheel.usdcPot();
        vm.prank(attacker);
        vm.expectRevert(MaintenanceJob.Replay.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
        assertEq(flywheel.usdcPot(), pot);
    }

    function test_signerRotationInvalidatesOldSig() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory oldSig) = _settleJob(1);
        uint256 newPk = 0xC0DE;
        gateway.setJobSigner(vm.addr(newPk));
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.BadSigner.selector);
        gateway.settleQuote(job, oldSig, address(usdc), amt, _emptyHops(), 1);
        bytes memory neu = _signPk(newPk, job);
        vm.prank(relayer);
        gateway.settleQuote(job, neu, address(usdc), amt, _emptyHops(), 1);
    }

    function test_gatewayPauseBlocksRelayer() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) = _settleJob(1);
        gateway.pauseGateway(true);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.Paused.selector);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
        gateway.pauseGateway(false);
        vm.prank(relayer);
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
    }

    function test_keeperPauseStillBlocksVault() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) = _settleJob(1);
        auth.pauseKeeper(true);
        vm.prank(relayer);
        vm.expectRevert();
        gateway.settleQuote(job, sig, address(usdc), amt, _emptyHops(), 1);
        auth.pauseKeeper(false);
    }

    function test_compromisedRelayerCannotSubstituteEpoch() public {
        (address honest,) = _instant(
            ReactorFactory.InstantParams({
                name: "HON",
                symbol: "HON",
                decimals: 18,
                supply: 0,
                quote: address(usdc),
                fdvQuoteRaw: 0,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _fillAndGraduate(alice, honest);
        (address evil,) = _instant(
            ReactorFactory.InstantParams({
                name: "EVL",
                symbol: "EVL",
                decimals: 18,
                supply: 0,
                quote: address(usdc),
                fdvQuoteRaw: 0,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _fillAndGraduate(bob, evil);
        _seedUsdcPot();
        uint256 amt = flywheel.settleTake(address(usdc));
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.settlePayload(address(usdc), amt, amt, hopsH);
        MaintenanceJob.Job memory settle = _job(MaintenanceJob.ACTION_SETTLE_QUOTE, payload, hopsH, keccak256("s2"));
        vm.prank(relayer);
        gateway.settleQuote(settle, _sign(settle), address(usdc), amt, _emptyHops(), amt);

        address[] memory targets = new address[](1);
        uint256[] memory weights = new uint256[](1);
        targets[0] = honest;
        weights[0] = 10_000;
        bytes32 valuation = keccak256("canonical");
        bytes32 health = keccak256("ok");
        uint256 epochId = flywheel.epoch();
        bytes32 snap = MaintenanceJob.epochSnapshotHash(epochId, targets, weights, valuation, health);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SUBMIT_EPOCH, snap, snap, keccak256("ep"));
        bytes memory sig = _sign(job);

        address[] memory swapped = new address[](1);
        swapped[0] = evil;
        vm.prank(attacker);
        vm.expectRevert(MaintenanceJob.WrongPayload.selector);
        gateway.submitEpoch(job, sig, epochId, swapped, weights, valuation, health);

        vm.prank(attacker);
        vm.expectRevert(MaintenanceJob.WrongPayload.selector);
        gateway.submitEpoch(job, sig, epochId, targets, weights, keccak256("forged"), health);

        vm.prank(relayer);
        gateway.submitEpoch(job, sig, epochId, targets, weights, valuation, health);
        assertEq(flywheel.ranked(0), honest);
        assertTrue(flywheel.ranked(0) != evil);
    }

    function test_onReportSameJobInterfaceAndNoGenericCall() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) = _settleJob(1);
        bytes memory args = abi.encode(address(usdc), amt, _emptyHops(), uint256(1));
        bytes memory report = abi.encode(job, sig, args);
        vm.prank(relayer);
        gateway.onReport("", report);
        assertTrue(gateway.usedJob(job.jobId));

        vm.prank(attacker);
        vm.expectRevert();
        gateway.onReport("", abi.encode(attacker, hex"deadbeef"));
    }

    function test_amountDriftReverts() public {
        _seedUsdcPot();
        uint256 amt = flywheel.settleTake(address(usdc));
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.settlePayload(address(usdc), amt + 1, 1, hopsH);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SETTLE_QUOTE, payload, hopsH, keccak256("drift"));
        bytes memory driftSig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.AmountMismatch.selector);
        gateway.settleQuote(job, driftSig, address(usdc), amt + 1, _emptyHops(), 1);
    }

    function test_nonGuardianCannotRotateOrPause() public {
        vm.prank(attacker);
        vm.expectRevert(AutomationGateway.NotGuardian.selector);
        gateway.setJobSigner(attacker);
        vm.prank(attacker);
        vm.expectRevert(AutomationGateway.NotGuardian.selector);
        gateway.pauseGateway(true);
    }

    function test_wrongActionReverts() public {
        _seedUsdcPot();
        (MaintenanceJob.Job memory job, uint256 amt, bytes memory sig) = _settleJob(1);
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.WrongAction.selector);
        gateway.executeSelfBurn(job, sig, address(usdc), amt, 1);
    }

    function test_unknownActionOnReportReverts() public {
        MaintenanceJob.Job memory job = _job(uint8(99), bytes32(uint256(1)), bytes32(0), keccak256("unknown-action"));
        bytes memory sig = _sign(job);
        bytes memory report = abi.encode(job, sig, bytes(""));
        vm.prank(relayer);
        vm.expectRevert(MaintenanceJob.UnknownAction.selector);
        gateway.onReport("", report);
    }
}
