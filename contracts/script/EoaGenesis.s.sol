// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ReactorGuardian} from "../src/ReactorGuardian.sol";
import {GenesisTypes} from "../src/libraries/GenesisTypes.sol";

/// @notice Encode `completeGenesis` for an EOA immutable Guardian after SAFE_GENESIS constructors.
///         Safe MultiSend (`SafeGenesisBatch`) remains the path when the Guardian *is* a Safe.
///
/// forge script script/EoaGenesis.s.sol:EoaGenesis --rpc-url $RPC
contract EoaGenesis is Script {
    function run() external view {
        address eoa = vm.envAddress("EXPECTED_SAFE");
        address deployer = vm.envAddress("DEPLOYER");
        address pricingSigner = vm.envAddress("EXPECTED_PRICING_SIGNER");
        address keeper = vm.envAddress("EXPECTED_KEEPER");
        address launchSigner = vm.envOr("EXPECTED_LAUNCH_SIGNER", pricingSigner);
        ReactorGuardian auth = ReactorGuardian(vm.envAddress("GUARDIAN_CONTRACT"));
        require(auth.guardian() == eoa, "guardian != EOA");
        require(eoa != deployer, "Guardian must not be deployer");
        require(pricingSigner != keeper && pricingSigner != eoa && pricingSigner != deployer, "pricing key reuse");
        require(launchSigner != keeper && launchSigner != eoa && launchSigner != deployer, "launch key reuse");
        require(auth.launchesPaused(), "must stay paused until genesis");
        require(!auth.genesisSealed(), "already sealed");

        bool unpause = vm.envOr("UNPAUSE_AFTER_VERIFY", false);
        GenesisTypes.Wiring memory w = GenesisTypes.Wiring({
            pricingSigner: pricingSigner,
            launchSigner: launchSigner,
            deployer: deployer,
            tickers: vm.envAddress("TICKER_REGISTRY"),
            factory: vm.envAddress("FACTORY"),
            registry: vm.envAddress("REGISTRY"),
            usdc: vm.envAddress("USDC"),
            hook: vm.envAddress("HOOK"),
            coreLp: vm.envAddress("CORE_LP"),
            userAdapter: vm.envAddress("USER_ADAPTER"),
            protocolAdapter: vm.envAddress("PROTOCOL_ADAPTER"),
            buyback: vm.envAddress("BUYBACK"),
            flywheel: vm.envAddress("FLYWHEEL"),
            launchModule: vm.envAddress("LAUNCH_MODULE"),
            vault: vm.envAddress("VAULT"),
            curve: vm.envAddress("CURVE"),
            selfBurn: vm.envAddress("SELF_BURN"),
            coreBuyback: vm.envAddress("CORE_BUYBACK"),
            router: vm.envAddress("ROUTER"),
            userRouter: vm.envAddress("USER_ROUTER"),
            vesting: vm.envAddress("VESTING"),
            core: vm.envAddress("CORE")
        });

        bytes memory data = abi.encodeWithSelector(ReactorGuardian.completeGenesis.selector, w, unpause);
        console2.log("EOA_GENESIS completeGenesis - Guardian EOA submits this one tx");
        console2.log("Guardian EOA", eoa);
        console2.log("Guardian contract", address(auth));
        console2.log("unpauseAfterVerify", unpause);
        console2.logBytes(data);
        if (!unpause) {
            console2.log("VERIFY - run VerifyGenesis (EXPECTED_SAFE = Guardian EOA) while paused");
            console2.log("BATCH B - finalizeGenesis(vesting) or activateLaunch + pauseLaunches(false)");
            console2.logBytes(abi.encodeWithSelector(ReactorGuardian.finalizeGenesis.selector, w.vesting));
        }
    }
}
