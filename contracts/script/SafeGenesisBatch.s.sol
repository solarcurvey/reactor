// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ReactorGuardian} from "../src/ReactorGuardian.sol";
import {InstantCurve} from "../src/InstantCurve.sol";
import {CoreVesting} from "../src/CoreVesting.sol";

/// @notice Phase-2 production genesis: encode Guardian MultiSend ops.
/// Deploy (phase 1) with FINAL Safe as immutable Guardian and SAFE_GENESIS=true.
/// This script prints the Safe batch. Safe executes. Then VerifyGenesis. Then Safe
/// unpauses launches and activateLaunch (T0). Never EOA-then-transfer.
///
/// forge script script/SafeGenesisBatch.s.sol:SafeGenesisBatch --rpc-url $RPC
contract SafeGenesisBatch is Script {
    function run() external view {
        address safe = vm.envAddress("EXPECTED_SAFE");
        ReactorGuardian auth = ReactorGuardian(vm.envAddress("GUARDIAN_CONTRACT"));
        require(auth.guardian() == safe, "guardian != Safe");
        require(safe != vm.envAddress("DEPLOYER"), "Safe must not be deployer");
        require(auth.launchesPaused(), "must stay paused until Safe T0");

        address curve = vm.envOr("CURVE", address(0));
        address userRouter = vm.envOr("USER_ROUTER", address(0));
        address vesting = vm.envOr("VESTING", address(0));

        console2.log("SAFE_GENESIS_BATCH");
        console2.log("Safe (only signer of these calls)", safe);
        console2.log("Guardian", address(auth));
        if (curve != address(0) && userRouter != address(0)) {
            console2.log("bindRouteExecutor");
            console2.logBytes(abi.encodeWithSelector(InstantCurve.bindRouteExecutor.selector, userRouter));
        }
        if (vesting != address(0)) {
            console2.log("activateLaunch");
            console2.logBytes(abi.encodeWithSelector(CoreVesting.activateLaunch.selector));
        }
        console2.log("pauseLaunches(false) — LAST, after verify");
        console2.logBytes(abi.encodeWithSelector(ReactorGuardian.pauseLaunches.selector, false));
        console2.log("Execute as Safe MultiSend. Deployer cannot call any of these.");
    }
}
