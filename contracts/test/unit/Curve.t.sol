// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {QuoteMath} from "../../src/libraries/QuoteMath.sol";
import {MockERC20} from "../../src/MockERC20.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

contract CurveTest is Base {
    using StateLibrary for IPoolManager;

    function _params(string memory name, string memory symbol, address quote, uint256 dev)
        internal
        pure
        returns (ReactorFactory.InstantParams memory p)
    {
        p = ReactorFactory.InstantParams({
            name: name,
            symbol: symbol,
            decimals: 8,
            supply: 99 ether,
            quote: quote,
            fdvQuoteRaw: 1,
            devBuyQuote: dev,
            image: "ipfs://x",
            description: "curve",
            website: "",
            twitter: "",
            telegram: ""
        });
    }

    function test_protocolOwnsSupplyDecimalsAndCurve() public {
        (address token,) = factory.instantLaunch(_params("A", "A", address(usdc), 0));
        assertEq(ReactorToken(token).totalSupply(), ReactorConstants.DEFAULT_SUPPLY);
        assertEq(ReactorToken(token).decimals(), 18);
        assertEq(curve.inventoryOf(token), 793_100_000 ether);
        assertEq(curve.reservedOf(token), 206_900_000 ether);
        (,,,,, bool live,) = factory.tokenInfo(token);
        assertFalse(live);
    }

    function test_devBuyAtomicFullFeeAndDisclose() public {
        uint256 pay = 105_600_000; // ~$105.60 for ~2%
        vm.startPrank(alice);
        usdc.approve(address(factory), pay);
        (address token,, uint256 out) = factory.launchAndBuy(_params("DEV", "DEV", address(usdc), pay), true, 1);
        vm.stopPrank();
        assertEq(ReactorToken(token).balanceOf(alice), out);
        assertGt(out, 0);
        assertLe(out, ReactorConstants.DEV_BUY_MAX_TOKENS);
        assertEq(curve.devBoughtOf(token), out);
        assertEq(ReactorToken(token).balanceOf(alice) + ReactorToken(token).balanceOf(address(curve)), 1_000_000_000 ether);
        assertEq(ReactorToken(token).pendingRewards(alice), 0);
        assertEq(ReactorToken(token).lifetimeRewards(), 0);
        assertGt(selfBurn.accrued(token), 0);
    }

    function test_devBuyOverFivePercentReverts() public {
        uint256 pay = 300e6; // above 5% token-out (~$271)
        vm.startPrank(alice);
        usdc.approve(address(factory), pay);
        vm.expectRevert();
        factory.launchAndBuy(_params("CAP", "CAP", address(usdc), pay), true, 1);
        vm.stopPrank();
    }

    function test_noFreeAllocation() public {
        (address token,) = factory.instantLaunch(_params("FREE", "FREE", address(usdc), 0));
        assertEq(ReactorToken(token).balanceOf(alice), 0);
        assertEq(ReactorToken(token).balanceOf(address(this)), 0);
        assertEq(ReactorToken(token).balanceOf(address(factory)), 0);
        assertEq(ReactorToken(token).balanceOf(address(curve)), 1_000_000_000 ether);
    }

    function test_rewardsGenesisNoHistoricCredit() public {
        uint256 pay = 52_300_000;
        vm.startPrank(alice);
        usdc.approve(address(factory), pay);
        (address token,, uint256 out) = factory.launchAndBuy(_params("GEN", "GEN", address(usdc), pay), true, 1);
        vm.stopPrank();
        // Zero-eligible Rewards fee goes to SelfBurn — not leftover rebate to first holder.
        assertEq(ReactorToken(token).pendingRewards(alice), 0);
        assertEq(ReactorToken(token).lifetimeRewards(), 0);
        assertGt(selfBurn.accrued(token), 0);
        _buy(bob, token, address(usdc), 200e6);
        assertGt(ReactorToken(token).lifetimeRewards(), 0);
        out;
    }

    function test_standardSelfBurnOnCurve() public {
        vm.prank(alice);
        (address token,) = factory.launchStandard(_params("STD", "STD", address(usdc), 0));
        assertFalse(factory.isRewards(token));
        _buy(bob, token, address(usdc), 1_000e6);
        assertEq(ReactorToken(token).lifetimeRewards(), 0);
        assertGt(selfBurn.accrued(token), 0);
        uint256 supply = ReactorToken(token).totalSupply();
        _keeperSelfBurn(token);
        assertLt(ReactorToken(token).totalSupply(), supply);
        assertGt(selfBurn.lifetimeBurned(), 0);
    }

    function test_standardSelfBurnAfterV4() public {
        vm.prank(alice);
        (address token,) = factory.launchStandard(_params("STD2", "ST2", address(usdc), 0));
        _fillAndGraduate(bob, token);
        _buy(carol, token, address(usdc), 400e6);
        hook.flush(token);
        uint256 acc = selfBurn.accrued(token);
        assertGt(acc, 0);
        uint256 supply = ReactorToken(token).totalSupply();
        _keeperSelfBurn(token);
        assertLt(ReactorToken(token).totalSupply(), supply);
    }

    function test_feeExemptNotCallableByWallet() public {
        (address token,) = factory.instantLaunch(_params("EX", "EX", address(usdc), 0));
        vm.startPrank(alice);
        usdc.approve(address(curve), 100e6);
        vm.expectRevert();
        curve.buyExempt(token, 100e6, 1);
        vm.expectRevert();
        router.protocolSwap(_key(token, address(usdc)), address(usdc) < token, -int256(100e6), 1, alice);
        vm.stopPrank();
    }

    function test_graduationOnceAndInventoryLocked() public {
        (address token,) = factory.instantLaunch(_params("G", "G", address(usdc), 0));
        _fillAndGraduate(alice, token);
        assertTrue(curve.graduatedOf(token));
        (,,,,, bool live,) = factory.tokenInfo(token);
        assertTrue(live);
        vm.expectRevert();
        curve.graduate(token);
        uint256 leftover = ReactorToken(token).balanceOf(address(curve));
        assertLt(leftover, 1_000 ether);
        vm.prank(alice);
        vm.expectRevert();
        curve.buy(token, 1e6, 1);
    }

    function test_lpReserveCannotLeakToCreator() public {
        (address token,) = factory.instantLaunch(_params("LP", "LP", address(usdc), 0));
        uint256 creatorBefore = ReactorToken(token).balanceOf(alice);
        _fillAndGraduate(bob, token);
        assertEq(ReactorToken(token).balanceOf(alice), creatorBefore);
        (,,,, PoolId poolId,,) = factory.tokenInfo(token);
        assertTrue(vault.locked(poolId));
        // 20.69% is locked as v4 LP, not transferable out of the vault.
        vm.prank(address(vault));
        vm.expectRevert();
        vault.lockLiquidity(_key(token, address(usdc)), -60, 60, -1);
    }

    function test_noCreatorOrAdminQuoteWithdraw() public {
        (address token,) = factory.instantLaunch(_params("W", "W", address(usdc), 0));
        _buy(alice, token, address(usdc), 1_000e6);
        uint256 onCurve = usdc.balanceOf(address(curve));
        assertGt(onCurve, 0);
        vm.prank(alice);
        vm.expectRevert();
        usdc.transferFrom(address(curve), alice, 1);
        vm.prank(address(this));
        vm.expectRevert();
        usdc.transferFrom(address(curve), address(this), 1);
    }

    function test_priceContinuityUsdc6() public {
        (address token,) = factory.instantLaunch(_params("P6", "P6", address(usdc), 0));
        _assertContinuity(token, address(usdc));
    }

    function test_priceContinuityZec8() public {
        address token = _instantZcat(1);
        _assertContinuity(token, address(zec));
    }

    function test_priceContinuityQuote18() public {
        MockERC20 q18 = new MockERC20("Q18", "Q18", 18, 0, address(this));
        q18.mint(alice, 1_000_000 ether);
        q18.mint(address(this), 1_000_000 ether);
        registry.register(address(q18), "Q18", "Q18", 18, "", QuoteAssetRegistry.Category.Stocks);
        registry.setBuybackRoute(address(q18), true, true);
        address token = _instantPriced(_params("P18", "P18", address(q18), 0), true);
        _assertContinuity(token, address(q18));
    }

    function test_ungraduatedNotTop10() public {
        (address token,) = factory.instantLaunch(_params("U", "U", address(usdc), 0));
        _buy(alice, token, address(usdc), 2_000e6);
        assertFalse(factory.isGraduatedReactor(token));
        address[] memory t = new address[](1);
        uint256[] memory w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_usdcHopMinOut() public {
        address token = _instantZcat(1);
        vm.startPrank(alice);
        usdc.approve(address(curve), 100e6);
        vm.expectRevert();
        curve.buyWithUsdc(token, 100e6, type(uint256).max);
        uint256 out = curve.buyWithUsdc(token, 100e6, 1);
        vm.stopPrank();
        assertGt(out, 0);
        assertGt(ReactorToken(token).balanceOf(alice), 0);
    }

    function test_launchAndBuyMinOut() public {
        uint256 pay = 52_300_000;
        vm.startPrank(alice);
        usdc.approve(address(factory), pay);
        vm.expectRevert();
        factory.launchAndBuy(_params("MO", "MO", address(usdc), pay), true, type(uint256).max);
        vm.stopPrank();
    }

    function _assertContinuity(address token, address quote) internal {
        _fillAndGraduate(alice, token);
        (,,,,,,, uint256 vq, uint256 vt,,,,,,) = curve.curves(token);
        (uint160 sqrtP,,,) = _slot0(_key(token, quote));
        uint256 one = 1 ether;
        bool tokenIs0 = token < quote;
        uint256 quoteOut = QuoteMath.expectedOut(sqrtP, one, tokenIs0);
        if (vt > 0 && vq > 0 && quoteOut > 0) {
            uint256 curvePx = (vq * 1e18) / vt;
            uint256 v4Px = quoteOut;
            uint256 lo = v4Px < curvePx ? v4Px : curvePx;
            uint256 hi = v4Px < curvePx ? curvePx : v4Px;
            if (lo > 0) assertLt((hi - lo) * 10_000 / lo, 200);
        }
    }
}
