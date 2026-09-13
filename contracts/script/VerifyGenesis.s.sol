// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {GenesisVerify} from "../src/libraries/GenesisVerify.sol";
import {ReactorGuardian} from "../src/ReactorGuardian.sol";
import {ReactorRouter} from "../src/ReactorRouter.sol";
import {QuoteAssetRegistry} from "../src/QuoteAssetRegistry.sol";
import {TestCORE} from "../src/TestCORE.sol";
import {CoreVesting} from "../src/CoreVesting.sol";
import {CoreLiquidityVault} from "../src/CoreLiquidityVault.sol";
import {ReactorConstants} from "../src/ReactorConstants.sol";
import {ReactorFactory} from "../src/ReactorFactory.sol";

/// @notice Post-deploy production check. Deploy with FINAL Safe (or EOA if no Safe) as Guardian — never transfer later.
///         forge script script/VerifyGenesis.s.sol:VerifyGenesis --rpc-url $RPC
contract VerifyGenesis is Script {
    function run() external view {
        ReactorGuardian auth = ReactorGuardian(vm.envAddress("GUARDIAN_CONTRACT"));
        address expectedSafe = vm.envAddress("EXPECTED_SAFE");
        address expectedKeeper = vm.envAddress("EXPECTED_KEEPER");
        address deployer = vm.envAddress("DEPLOYER");
        TestCORE core = TestCORE(vm.envAddress("CORE"));
        CoreVesting vesting = CoreVesting(vm.envAddress("VESTING"));
        CoreLiquidityVault coreLp = CoreLiquidityVault(vm.envAddress("CORE_LP"));
        QuoteAssetRegistry registry = QuoteAssetRegistry(vm.envAddress("REGISTRY"));
        ReactorRouter router = ReactorRouter(vm.envAddress("ROUTER"));

        GenesisVerify.verifyProduction(
            auth, expectedSafe, expectedKeeper, deployer, core, vesting, coreLp, registry, router
        );

        require(auth.guardian() == expectedSafe, "guardian");
        require(auth.keeper() == expectedKeeper, "keeper");
        require(core.totalSupply() == 1_000_000_000 ether, "supply");
        require(vesting.BENEFICIARY() == ReactorConstants.CORE_VESTING_BENEFICIARY, "beneficiary");
        require(registry.isUsdPegOne(registry.usdc()), "usdPegOne");
        require(!registry.isUsdPegOne(address(0)), "zero peg");
        require(router.protocolVaultsSealed(), "sealed");
        require(auth.launchesPaused(), "launches must stay paused until Safe enables");
        require(core.balanceOf(deployer) == 0 && core.balanceOf(expectedSafe) == 0 && core.balanceOf(expectedKeeper) == 0, "core dust");

        address pricing = vm.envOr("EXPECTED_PRICING_SIGNER", address(0));
        if (pricing != address(0)) {
            GenesisVerify.verifyFullyWired(
                auth,
                expectedSafe,
                expectedKeeper,
                pricing,
                deployer,
                vm.envAddress("USER_ADAPTER"),
                vm.envAddress("PROTOCOL_ADAPTER"),
                vm.envAddress("FACTORY"),
                vm.envAddress("CURVE"),
                vm.envAddress("SELF_BURN"),
                vm.envAddress("USER_ROUTER")
            );
            require(auth.pricingSigner() != expectedKeeper, "pricing signer reused keeper");
        }

        address factory = vm.envOr("FACTORY", address(0));
        if (factory != address(0)) {
            require(ReactorFactory(factory).instantCurveConfig() == keccak256("REACTOR.InstantCurve.v1"), "curve");
        }

        console2.log("GENESIS_OK Safe", expectedSafe);
        console2.log("Keeper", expectedKeeper);
        console2.log("CORE supply 1B; vest 100M; LP 900M accounted");
        console2.log("usdPegOne USDC only; launches paused; no deployer privilege");
    }
}
