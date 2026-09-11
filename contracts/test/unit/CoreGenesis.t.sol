// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {TestCORE} from "../../src/TestCORE.sol";
import {CoreVesting} from "../../src/CoreVesting.sol";
import {CoreLiquidityVault} from "../../src/CoreLiquidityVault.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorHook} from "../../src/ReactorHook.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";

/// @notice §28 CORE genesis — 35 cases.
contract CoreGenesisTest is Base {
    address internal constant BENEFICIARY = ReactorConstants.CORE_VESTING_BENEFICIARY;

    function test_28_01_supplyExactly1B() public view {
        assertEq(core.totalSupply(), 1_000_000_000 ether);
    }

    function test_28_02_cannotMintAfterGenesis() public {
        vm.expectRevert(TestCORE.AlreadyMinted.selector);
        core.genesis(address(coreVesting), address(coreLp));
        (bool ok,) = address(core).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1));
        assertFalse(ok);
    }

    function test_28_03_burnReducesTotalSupply() public {
        uint256 s0 = core.totalSupply();
        usdc.mint(address(buyback), 50_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 50_000e6);
        _keeperCore(address(usdc));
        assertLt(core.totalSupply(), s0);
        assertGt(buyback.lifetimeBurned(), 0);
    }

    function test_28_04_noDeadFallback() public {
        (bool ok,) = address(buyback).call(abi.encodeWithSignature("DEAD()"));
        assertFalse(ok);
    }

    function test_28_05_deployerCoreZero() public view {
        assertEq(core.balanceOf(address(this)), 0);
    }

    function test_28_06_guardianCoreZero() public view {
        assertEq(core.balanceOf(guardian), 0);
    }

    function test_28_07_keeperCoreZero() public view {
        assertEq(core.balanceOf(keeper), 0);
    }

    function test_28_08_vestingHolds100M() public view {
        assertEq(core.balanceOf(address(coreVesting)), 100_000_000 ether);
    }

    function test_28_09_lpPlusPmAccount900M() public view {
        uint256 vault = core.balanceOf(address(coreLp));
        uint256 pmBal = core.balanceOf(address(pm));
        assertEq(vault + pmBal, 900_000_000 ether);
        assertEq(core.balanceOf(address(coreVesting)) + vault + pmBal, 1_000_000_000 ether);
    }

    function test_28_10_beneficiaryImmutable() public view {
        assertEq(coreVesting.BENEFICIARY(), BENEFICIARY);
    }

    function test_28_11_t0IsLaunchNotDeployConstruct() public {
        CoreVesting v = new CoreVesting(address(core), auth, 0);
        assertEq(v.t0(), 0);
    }

    function test_28_12_activateLaunchOnce() public {
        vm.expectRevert(CoreVesting.Frozen.selector);
        coreVesting.activateLaunch();
    }

    function test_28_13_strangerCannotActivate() public {
        CoreVesting v = new CoreVesting(address(core), auth, 0);
        vm.prank(alice);
        vm.expectRevert(CoreVesting.NotGuardian.selector);
        v.activateLaunch();
    }

    function test_28_14_beforeCliffZero() public view {
        assertEq(coreVesting.vested(), 0);
        assertEq(coreVesting.claimable(), 0);
    }

    function test_28_15_atCliffStillZero() public {
        vm.warp(uint256(coreVesting.t0()) + 30 days);
        assertEq(coreVesting.vested(), 0);
    }

    function test_28_16_linearAfterCliff() public {
        vm.warp(uint256(coreVesting.t0()) + 30 days + 150 days);
        assertEq(coreVesting.vested(), 50_000_000 ether);
    }

    function test_28_17_fullAfterTenMonths() public {
        vm.warp(uint256(coreVesting.t0()) + 30 days + 300 days);
        assertEq(coreVesting.vested(), 100_000_000 ether);
    }

    function test_28_18_claimOnlyToBeneficiary() public {
        vm.warp(uint256(coreVesting.t0()) + 30 days + 30 days);
        vm.prank(alice);
        vm.expectRevert(CoreVesting.NotBeneficiary.selector);
        coreVesting.claim();
        uint256 due = coreVesting.claimable();
        assertGt(due, 0);
        vm.prank(BENEFICIARY);
        coreVesting.claim();
        assertEq(core.balanceOf(BENEFICIARY), due);
        assertEq(coreVesting.claimed(), due);
    }

    function test_28_19_noAdminWithdraw() public {
        (bool ok,) = address(coreVesting).call(abi.encodeWithSignature("withdraw(address,uint256)", alice, 1));
        assertFalse(ok);
        (ok,) = address(coreVesting).call(abi.encodeWithSignature("revoke()"));
        assertFalse(ok);
        (ok,) = address(coreVesting).call(abi.encodeWithSignature("sweep(address)", alice));
        assertFalse(ok);
    }

    function test_28_20_guardianCannotSweep() public {
        vm.prank(guardian);
        (bool ok,) = address(coreVesting).call(abi.encodeWithSignature("transfer(address,uint256)", guardian, 1));
        assertFalse(ok);
    }

    function test_28_21_keeperCannotClaim() public {
        vm.warp(uint256(coreVesting.t0()) + 200 days);
        vm.prank(keeper);
        vm.expectRevert(CoreVesting.NotBeneficiary.selector);
        coreVesting.claim();
    }

    function test_28_22_cannotChangeBeneficiary() public {
        (bool ok,) = address(coreVesting).call(abi.encodeWithSignature("setBeneficiary(address)", alice));
        assertFalse(ok);
    }

    function test_28_23_officialHookedCoreUsdc() public view {
        (address t, address q, bool live) = hook.marketOfToken(address(core));
        assertTrue(live);
        assertEq(t, address(core));
        assertEq(q, address(usdc));
        assertEq(address(coreKey.hooks), address(hook));
        assertEq(coreKey.fee, 0);
    }

    function test_28_24_notBondingOrFactoryToken() public view {
        (address t,,,,, bool live,) = factory.tokenInfo(address(core));
        assertEq(t, address(0));
        assertFalse(live);
        assertFalse(curve.readyOf(address(core)));
    }

    function test_28_25_cannotLaunchWithCoreQuote() public {
        vm.expectRevert();
        factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "X",
                symbol: "X",
                decimals: 18,
                supply: 0,
                quote: address(core),
                fdvQuoteRaw: 0,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function test_28_26_top10SubmitCoreReverts() public {
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = address(core);
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_28_27_top10ExecuteCoreReverts() public {
        vm.prank(keeper);
        flywheel.submitEpoch(0, new address[](0), new uint256[](0));
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.executeTop10Buyback(address(core), _emptyHops(), 1);
    }

    function test_28_28_externalCoreTrade25And10() public {
        (uint256 h, uint256 f, uint256 c, uint256 fee) = FeeMath.splitCore(1_000e6);
        assertEq(h, 0);
        assertEq(f, 10e6);
        assertEq(c, 25e6);
        assertEq(fee, 35e6);
        uint256 bb0 = buyback.lifetimeAccrued();
        uint256 fw0 = flywheel.lifetimeAccrued();
        usdc.approve(address(router), 1_000e6);
        router.swap(coreKey, address(usdc) < address(core), -int256(1_000e6), 1, address(this));
        assertEq(buyback.lifetimeAccrued() - bb0, 25e6);
        assertEq(flywheel.lifetimeAccrued() - fw0, 10e6);
    }

    function test_28_29_noDoubleChargeOnCoreMarket() public {
        usdc.approve(address(router), 10_000e6);
        router.swap(coreKey, address(usdc) < address(core), -int256(10_000e6), 1, address(this));
        assertEq(hook.pendingTokenRewards(address(core)), 0);
        assertEq(hook.pendingSelfBurn(address(core)), 0);
    }

    function test_28_30_nonCoreStillSends05ToCore() public {
        (address token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "N",
                symbol: "N",
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
        uint256 bb0 = buyback.lifetimeAccrued();
        _buy(alice, token, address(usdc), 10_000e6);
        assertEq(buyback.lifetimeAccrued() - bb0, 50e6);
    }

    function test_28_31_userSwapPaysFee() public {
        uint256 bb0 = buyback.lifetimeAccrued();
        usdc.approve(address(router), 500e6);
        router.swap(coreKey, address(usdc) < address(core), -int256(500e6), 1, alice);
        assertGt(buyback.lifetimeAccrued(), bb0);
    }

    function test_28_32_executorBuyIsFeeExempt() public {
        usdc.mint(address(buyback), 20_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 20_000e6);
        uint256 bb0 = buyback.lifetimeAccrued();
        uint256 s0 = core.totalSupply();
        _keeperCore(address(usdc));
        assertEq(buyback.lifetimeAccrued(), bb0, "maintenance must not re-accrue 3.5%");
        assertLt(core.totalSupply(), s0);
    }

    function test_28_33_keeperEoaNotExempt() public {
        usdc.mint(keeper, 1_000e6);
        vm.startPrank(keeper);
        usdc.approve(address(router), 1_000e6);
        uint256 bb0 = buyback.lifetimeAccrued();
        router.swap(coreKey, address(usdc) < address(core), -int256(1_000e6), 1, keeper);
        vm.stopPrank();
        assertEq(buyback.lifetimeAccrued() - bb0, 25e6);
    }

    function test_28_34_minTargetOutZeroReverts() public {
        usdc.mint(address(buyback), 20_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 20_000e6);
        vm.prank(keeper);
        vm.expectRevert();
        buyback.execute(address(usdc), _emptyHops(), 0);
    }

    function test_28_35_lpWithdrawDisabledAndChunk() public {
        vm.expectRevert();
        coreLp.unlockCallback(abi.encode(coreKey, int24(0), int24(60), int256(-1)));
        usdc.mint(address(buyback), 1_000_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 1_000_000e6);
        uint256 before = buyback.accrued(address(usdc));
        _keeperCore(address(usdc));
        uint256 spent = before - buyback.accrued(address(usdc));
        assertLt(spent, before);
    }
}
