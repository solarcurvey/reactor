// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {AutomationGateway} from "../../src/AutomationGateway.sol";
import {MaintenanceJob} from "../../src/libraries/MaintenanceJob.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";

/// @notice Gateway is the designated Keeper. Relayers only deliver signed jobs.
contract AutomationGatewayTest is Base {
    AutomationGateway internal gateway;
    uint256 internal jobPk;
    address internal jobSignerAddr;
    address internal relayer;
    address internal relayer2;

    function setUp() public override {
        super.setUp();
        jobPk = 0xB0B;
        jobSignerAddr = vm.addr(jobPk);
        relayer = makeAddr("relayer");
        relayer2 = makeAddr("relayer2");
        gateway = new AutomationGateway(auth, jobSignerAddr, selfBurn, flywheel, buyback);
        auth.setKeeper(address(gateway));
    }

    function _sign(MaintenanceJob.Job memory job) internal view returns (bytes memory sig) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(jobPk, MaintenanceJob.digest(gateway.domainSeparator(), job));
        sig = abi.encodePacked(r, s, v);
    }

    function _job(uint8 action, bytes32 payload, bytes32 snap, bytes32 jobId)
        internal
        view
        returns (MaintenanceJob.Job memory job)
    {
        job = MaintenanceJob.Job({
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

    function _standardToken() internal returns (address token) {
        vm.prank(alice);
        (token,) = _standard(
            ReactorFactory.InstantParams({
                name: "SB",
                symbol: "SB",
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
        _buy(bob, token, address(usdc), 5_000e6);
    }

    function test_selfBurnHappyPathAndDirectKeeperBlocked() public {
        address token = _standardToken();
        uint256 amt = selfBurn.executeTake(token);
        assertGe(amt, ReactorConstants.DEFAULT_SETTLE_THRESHOLD);
        bytes32 payload = MaintenanceJob.selfBurnPayload(token, amt, 2);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SELF_BURN, payload, bytes32(0), keccak256("sb1"));
        vm.prank(relayer);
        uint256 burned = gateway.executeSelfBurn(job, _sign(job), token, amt, 2);
        assertGt(burned, 1);
        assertTrue(gateway.usedJob(job.jobId));

        vm.prank(keeper);
        vm.expectRevert();
        selfBurn.execute(token, 2);
    }

    function test_settleQuoteBindsAmountAndHops() public {
        usdc.mint(address(flywheel), 50_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 50_000e6);
        uint256 amt = flywheel.settleTake(address(usdc));
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.settlePayload(address(usdc), amt, amt, hopsH);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SETTLE_QUOTE, payload, hopsH, keccak256("settle1"));
        vm.prank(relayer);
        uint256 got = gateway.settleQuote(job, _sign(job), address(usdc), amt, _emptyHops(), amt);
        assertEq(got, flywheel.usdcPot());
        assertGt(got, 0);
    }

    function test_submitEpochBindsValuationSnapshot() public {
        address token = _usdcGrad();
        _seedFw(3_000e6);
        address[] memory targets = new address[](1);
        uint256[] memory weights = new uint256[](1);
        targets[0] = token;
        weights[0] = 10_000;
        bytes32 valuation = keccak256("GET /top10 valuation-service");
        bytes32 health = keccak256("pricing/health ok");
        uint256 epochId = flywheel.epoch();
        bytes32 snap = MaintenanceJob.epochSnapshotHash(epochId, targets, weights, valuation, health);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SUBMIT_EPOCH, snap, snap, keccak256("epoch1"));
        vm.prank(relayer);
        gateway.submitEpoch(job, _sign(job), epochId, targets, weights, valuation, health);
        assertTrue(flywheel.epochFinalized());
        assertEq(flywheel.ranked(0), token);
    }

    function test_top10ThenRollThroughGateway() public {
        address token = _usdcGrad();
        _seedFw(3_000e6);
        _gwSubmit(token);
        uint256 share = flywheel.top10Share(token);
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.top10Payload(token, share, 2, hopsH);
        MaintenanceJob.Job memory buy = _job(MaintenanceJob.ACTION_TOP10_BUYBACK, payload, hopsH, keccak256("t10"));
        vm.prank(relayer);
        uint256 bought = gateway.executeTop10Buyback(buy, _sign(buy), token, share, _emptyHops(), 2);
        assertGt(bought, 1);
        assertEq(ReactorToken(token).balanceOf(relayer), 0);

        uint256 epochId = flywheel.epoch();
        bytes32 rollP = MaintenanceJob.rollPayload(epochId);
        MaintenanceJob.Job memory roll = _job(MaintenanceJob.ACTION_ROLL_EPOCH, rollP, rollP, keccak256("roll1"));
        vm.prank(relayer2);
        gateway.rollEpoch(roll, _sign(roll), epochId);
        assertEq(flywheel.epoch(), epochId + 1);
        assertFalse(flywheel.epochFinalized());
    }

    function test_buybackThroughGateway() public {
        usdc.mint(address(buyback), 20_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 20_000e6);
        uint256 amt = buyback.executeTake(address(usdc));
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.buybackPayload(address(usdc), amt, 2, hopsH);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_BUYBACK, payload, hopsH, keccak256("bb1"));
        vm.prank(relayer);
        uint256 coreOut = gateway.executeBuyback(job, _sign(job), address(usdc), amt, _emptyHops(), 2);
        assertGt(coreOut, 1);
    }

    function test_graduateRemainsPermissionless() public {
        (address token,) = _instant(
            ReactorFactory.InstantParams({
                name: "G",
                symbol: "G",
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
        address quote = address(usdc);
        for (uint256 i; i < 6 && !curve.readyOf(token); i++) {
            uint256 realQuote = curve.realQuoteOf(token);
            uint256 gradTarget = curve.gradTargetOf(token);
            if (realQuote >= gradTarget) break;
            uint256 need = gradTarget - realQuote;
            _bondToward(alice, token, quote, (need * 10_000) / 9_650 + need / 50 + 1);
        }
        assertTrue(curve.readyOf(token));
        assertFalse(curve.graduatedOf(token));
        vm.prank(alice);
        curve.graduate(token);
        assertTrue(curve.graduatedOf(token));
    }

    function test_cooldownAndChunkStillApply() public {
        address token = _standardToken();
        uint256 first = selfBurn.executeTake(token);
        bytes32 payload = MaintenanceJob.selfBurnPayload(token, first, 2);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SELF_BURN, payload, bytes32(0), keccak256("cd1"));
        vm.prank(relayer);
        gateway.executeSelfBurn(job, _sign(job), token, first, 2);
        uint256 leftover = selfBurn.accrued(token);
        if (leftover >= ReactorConstants.DEFAULT_SETTLE_THRESHOLD) {
            uint256 second = selfBurn.executeTake(token);
            bytes32 p2 = MaintenanceJob.selfBurnPayload(token, second, 2);
            MaintenanceJob.Job memory job2 = _job(MaintenanceJob.ACTION_SELF_BURN, p2, bytes32(0), keccak256("cd2"));
            bytes memory sig2 = _sign(job2);
            vm.prank(relayer);
            vm.expectRevert();
            gateway.executeSelfBurn(job2, sig2, token, second, 2);
            vm.warp(block.timestamp + ReactorConstants.KEEPER_COOLDOWN);
            vm.prank(relayer);
            gateway.executeSelfBurn(job2, sig2, token, second, 2);
        }
    }

    function test_unapprovedAdapterStillRejected() public {
        zec.mint(address(flywheel), 1_000e8);
        vm.prank(address(hook));
        flywheel.accrue(address(zec), 1_000e8);
        auth.setAdapter(address(protocolAdapter), false);
        RouteGuard.Hop[] memory hops = _protocolHop(address(zec), address(usdc), zecUsdcKey);
        uint256 amt = flywheel.settleTake(address(zec));
        bytes32 hopsH = MaintenanceJob.hashHops(hops);
        bytes32 payload = MaintenanceJob.settlePayload(address(zec), amt, 2, hopsH);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SETTLE_QUOTE, payload, hopsH, keccak256("adp"));
        bytes memory sig = _sign(job);
        vm.prank(relayer);
        vm.expectRevert();
        gateway.settleQuote(job, sig, address(zec), amt, hops, 2);
        auth.setAdapter(address(protocolAdapter), true);
    }

    function _usdcGrad() internal returns (address token) {
        (token,) = _instant(
            ReactorFactory.InstantParams({
                name: "T10",
                symbol: "T10",
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
        _fillAndGraduate(alice, token);
    }

    function _seedFw(uint256 amt) internal {
        usdc.mint(address(flywheel), amt);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), amt);
        uint256 take = flywheel.settleTake(address(usdc));
        bytes32 hopsH = MaintenanceJob.hashHops(_emptyHops());
        bytes32 payload = MaintenanceJob.settlePayload(address(usdc), take, take, hopsH);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SETTLE_QUOTE, payload, hopsH, keccak256(abi.encode("seed", amt)));
        vm.prank(relayer);
        gateway.settleQuote(job, _sign(job), address(usdc), take, _emptyHops(), take);
    }

    function _gwSubmit(address token) internal {
        address[] memory targets = new address[](1);
        uint256[] memory weights = new uint256[](1);
        targets[0] = token;
        weights[0] = 10_000;
        bytes32 valuation = keccak256("snap");
        bytes32 health = keccak256("ok");
        uint256 epochId = flywheel.epoch();
        bytes32 snap = MaintenanceJob.epochSnapshotHash(epochId, targets, weights, valuation, health);
        MaintenanceJob.Job memory job = _job(MaintenanceJob.ACTION_SUBMIT_EPOCH, snap, snap, keccak256(abi.encode("sub", token)));
        vm.prank(relayer);
        gateway.submitEpoch(job, _sign(job), epochId, targets, weights, valuation, health);
    }
}
