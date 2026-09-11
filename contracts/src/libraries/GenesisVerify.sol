// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "../ReactorGuardian.sol";
import {ReactorRouter} from "../ReactorRouter.sol";
import {QuoteAssetRegistry} from "../QuoteAssetRegistry.sol";
import {TestCORE} from "../TestCORE.sol";
import {CoreVesting} from "../CoreVesting.sol";
import {CoreLiquidityVault} from "../CoreLiquidityVault.sol";
import {ReactorConstants} from "../ReactorConstants.sol";

/// @notice Post-genesis checks. Production: deploy with the FINAL Safe as Guardian. Never transfer later.
library GenesisVerify {
    error BadGuardian();
    error BadKeeper();
    error DeployerPrivilege();
    error CoreAccounting();
    error LaunchesNotPaused();
    error Peg();
    error Fees();
    error NotSealed();
    error KeyReuse();
    error NotWired();
    error Adapter();

    function verifyProduction(
        ReactorGuardian auth,
        address expectedSafe,
        address expectedKeeper,
        address deployer,
        TestCORE core,
        CoreVesting vesting,
        CoreLiquidityVault coreLp,
        QuoteAssetRegistry registry,
        ReactorRouter router
    ) internal view {
        if (expectedSafe == address(0) || expectedSafe == deployer) revert DeployerPrivilege();
        if (auth.guardian() != expectedSafe) revert BadGuardian();
        if (auth.keeper() != expectedKeeper) revert BadKeeper();
        if (core.balanceOf(deployer) != 0) revert DeployerPrivilege();
        if (core.balanceOf(expectedSafe) != 0) revert DeployerPrivilege();
        if (core.balanceOf(expectedKeeper) != 0) revert DeployerPrivilege();
        verifyAccounting(core, vesting, coreLp, registry);
        if (!router.protocolVaultsSealed()) revert NotSealed();
        if (!auth.launchesPaused()) revert LaunchesNotPaused();
    }

    function verifyAccounting(TestCORE core, CoreVesting vesting, CoreLiquidityVault coreLp, QuoteAssetRegistry registry)
        internal
        view
    {
        if (core.totalSupply() != 1_000_000_000 ether) revert CoreAccounting();
        if (core.balanceOf(address(vesting)) != ReactorConstants.CORE_VESTING_AMOUNT) revert CoreAccounting();
        uint256 lpHeld = core.balanceOf(address(coreLp)) + core.balanceOf(address(coreLp.poolManager()));
        if (lpHeld != ReactorConstants.CORE_LP_AMOUNT) revert CoreAccounting();
        if (vesting.BENEFICIARY() != ReactorConstants.CORE_VESTING_BENEFICIARY) revert CoreAccounting();
        if (ReactorConstants.HOLDER_FEE_BPS != 200) revert Fees();
        if (ReactorConstants.FLYWHEEL_FEE_BPS != 100) revert Fees();
        if (ReactorConstants.CORE_FEE_BPS != 50) revert Fees();
        if (ReactorConstants.PROTOCOL_FEE_BPS != 350) revert Fees();
        if (!registry.isUsdPegOne(registry.usdc())) revert Peg();
    }

    /// @notice Production Safe MultiSend must leave keys isolated and every one-time bind set.
    function verifyFullyWired(
        ReactorGuardian auth,
        address expectedSafe,
        address expectedKeeper,
        address expectedPricingSigner,
        address deployer,
        address userAdapter,
        address protocolAdapter,
        address factory,
        address curve,
        address selfBurn,
        address routeExecutor
    ) internal view {
        if (expectedSafe == deployer) revert DeployerPrivilege();
        if (auth.guardian() != expectedSafe) revert BadGuardian();
        if (auth.keeper() != expectedKeeper) revert BadKeeper();
        if (expectedPricingSigner == address(0) || expectedPricingSigner == expectedKeeper) revert KeyReuse();
        if (auth.pricingSigner() != expectedPricingSigner) revert KeyReuse();
        if (!auth.adapterApproved(userAdapter) || !auth.adapterApproved(protocolAdapter)) revert Adapter();
        if (factory == address(0) || curve == address(0) || selfBurn == address(0) || routeExecutor == address(0)) {
            revert NotWired();
        }
        if (!auth.launchesPaused()) revert LaunchesNotPaused();
    }
}
