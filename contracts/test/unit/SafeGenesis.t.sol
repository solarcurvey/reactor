// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {GenesisVerify} from "../../src/libraries/GenesisVerify.sol";
import {ReactorGuardian} from "../../src/ReactorGuardian.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";

/// @notice Production genesis: FINAL Safe is Guardian from block 0. Deployer keeps no privilege.
contract SafeGenesisTest is Base {
    function test_accountingMatchesFrozenGenesis() public view {
        GenesisVerify.verifyAccounting(core, coreVesting, coreLp, registry);
        assertTrue(registry.isUsdPegOne(address(usdc)));
        assertEq(core.balanceOf(address(this)), 0);
        assertEq(core.balanceOf(guardian), 0);
        assertEq(core.balanceOf(keeper), 0);
        assertTrue(router.protocolVaultsSealed());
        assertEq(factory.instantCurveConfig(), keccak256("REACTOR.InstantCurve.v1"));
    }

    function test_productionSafeRejectsDeployerAsGuardian() public {
        address safe = makeAddr("FINAL_SAFE");
        address k = makeAddr("PROD_KEEPER");
        vm.expectRevert(GenesisVerify.DeployerPrivilege.selector);
        this._verifyAs(address(this), k, address(this));
        // Guardian in this fixture is the test contract — production check must fail.
        vm.expectRevert(GenesisVerify.BadGuardian.selector);
        this._verifyAs(safe, k, address(this));
    }

    function test_freshSafeGuardianHasNoCoreAndLaunchesPaused() public {
        address safe = makeAddr("FINAL_SAFE");
        address k = makeAddr("PROD_KEEPER");
        ReactorGuardian g = new ReactorGuardian(safe, k);
        vm.prank(safe);
        g.pauseLaunches(true);
        assertEq(g.guardian(), safe);
        assertTrue(g.launchesPaused());
        assertEq(core.balanceOf(safe), 0);
        assertEq(core.balanceOf(k), 0);
        // No owner/admin slot — guardian is immutable.
        (bool ok,) = address(g).call(abi.encodeWithSignature("transferGuardian(address)", address(this)));
        assertFalse(ok);
        (ok,) = address(g).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
    }

    function test_deployerHasNoPostGenesisAdmin() public view {
        assertEq(auth.guardian(), address(this), "fixture guardian is the test - production uses a Safe");
        assertTrue(router.protocolVaultsSealed());
        assertEq(core.balanceOf(address(this)), 0);
        assertEq(ReactorConstants.CORE_VESTING_BENEFICIARY, 0x4583F9b7a06aB8B5b7B4A7dD27e774356015d406);
    }

    function _verifyAs(address safe, address k, address deployer) external view {
        GenesisVerify.verifyProduction(auth, safe, k, deployer, core, coreVesting, coreLp, registry, router);
    }
}
