// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorHook} from "../../src/ReactorHook.sol";
import {ReactorRouter} from "../../src/ReactorRouter.sol";
import {ReactorLiquidityVault} from "../../src/ReactorLiquidityVault.sol";
import {BuybackVault} from "../../src/BuybackVault.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";
import {MockERC20} from "../../src/MockERC20.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LaunchMath} from "../../src/libraries/LaunchMath.sol";
import {LiquidityAmounts} from "../../src/libraries/LiquidityAmounts.sol";

contract SecurityTest is Base {
    function test_initFrontrun_maliciousBinderFails() public {
        vm.prank(alice);
        vm.expectRevert(ReactorHook.NotGuardian.selector);
        hook.bindFactory(alice);
        vm.prank(alice);
        vm.expectRevert(ReactorHook.NotGuardian.selector);
        hook.bindBuyback(BuybackVault(alice));
        vm.prank(alice);
        vm.expectRevert(ReactorLiquidityVault.NotGuardian.selector);
        vault.bindFactory(alice);

        vm.expectRevert(ReactorHook.AlreadyBound.selector);
        hook.bindFactory(alice);
        vm.expectRevert(ReactorHook.AlreadyBound.selector);
        hook.bindBuyback(BuybackVault(address(this)));
        vm.expectRevert(ReactorLiquidityVault.AlreadyBound.selector);
        vault.bindFactory(alice);
    }

    function test_minOutZeroReverts() public {
        address token = _instantZcat(40_000e8);
        _approveRouter(alice, address(zec), 100e8);
        vm.prank(alice);
        vm.expectRevert();
        router.swap(_key(token, address(zec)), address(zec) < token, -int256(100e8), 0, alice);
    }

    function test_exactOutDisabled() public {
        address token = _instantZcat(40_000e8);
        _approveRouter(alice, address(zec), 100e8);
        vm.prank(alice);
        vm.expectRevert();
        router.swap(_key(token, address(zec)), address(zec) < token, int256(1e18), 1, alice);
    }

    function test_slippageRevertAfterPriceMove() public {
        address token = _instantZcat(40_000e8);
        uint256 out1 = _buy(alice, token, address(zec), 200e8);
        _buy(bob, token, address(zec), 8_000e8);
        vm.prank(alice);
        zec.approve(address(curve), 200e8);
        vm.prank(alice);
        vm.expectRevert();
        curve.buy(token, 200e8, out1);
    }

    function test_partialFillRejectedAtInstantEdge() public {
        // Thin hookless pool: exact-in larger than remaining depth must revert.
        address a = address(usdc) < address(zec) ? address(usdc) : address(zec);
        address b = address(usdc) < address(zec) ? address(zec) : address(usdc);
        PoolKey memory thin = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: 10_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        uint256 amt0 = a == address(usdc) ? 1e6 : 1e8;
        uint256 amt1 = a == address(usdc) ? 1e8 : 1e6;
        uint160 sqrtP = LaunchMath.encodeSqrtPriceX96(amt1, amt0);
        pm.initialize(thin, sqrtP);
        int24 mid = TickMath.getTickAtSqrtPrice(sqrtP);
        int24 lo = LaunchMath.alignTick(mid, 60) - 60;
        int24 hi = lo + 120;
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), amt0, amt1
        );
        usdc.approve(address(router), type(uint256).max);
        zec.approve(address(router), type(uint256).max);
        router.addLiquidity(thin, lo, hi, int256(uint256(liq)));

        usdc.mint(alice, 50_000e6);
        _approveRouter(alice, address(usdc), 50_000e6);
        bool zfo = address(usdc) < address(zec);
        vm.prank(alice);
        vm.expectRevert(ReactorRouter.IncompleteFill.selector);
        router.swap(thin, zfo, -int256(50_000e6), 1, alice);

        // Instant one-sided market still accepts a fillable exact-in.
        address token = _instantZcat(5_000e8);
        _buy(alice, token, address(zec), 50e8);
        assertGt(ReactorToken(token).balanceOf(alice), 0);
    }

    function test_wrongPoolFakeTokenFlush() public {
        address zcat = _instantZcat(40_000e8);
        _buy(alice, zcat, address(zec), 500e8);
        MockERC20 fake = new MockERC20("FAKE", "FAKE", 18, 1e24, address(this));
        vm.expectRevert(ReactorHook.UnknownLaunch.selector);
        hook.flush(address(fake));
        vm.expectRevert(ReactorHook.UnknownLaunch.selector);
        hook.flush(address(usdc), address(fake));
        vm.expectRevert(ReactorHook.UnknownLaunch.selector);
        hook.flush(address(usdc), zcat);
        _fillAndGraduate(alice, zcat);
        vm.expectRevert(ReactorHook.QuoteMismatch.selector);
        hook.flush(address(usdc), zcat);
    }

    function test_maliciousQuoteNotLaunchable() public {
        MockERC20 evil = new MockERC20("EVIL", "EVIL", 18, 0, address(this));
        vm.expectRevert();
        factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "X",
                symbol: "X",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(evil),
                fdvQuoteRaw: 1 ether,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function test_routeUnavailableSkips() public {
        MockERC20 orphan = new MockERC20("ORPH", "ORPH", 6, 0, address(this));
        registry.register(address(orphan), "ORPH", "Orphan", 6, "", QuoteAssetRegistry.Category.Crypto);
        // no buyback route → cannot launch
        vm.expectRevert();
        factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "O",
                symbol: "O",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(orphan),
                fdvQuoteRaw: 1e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function test_manipulatedCoreSpotDoesNotDrain() public {
        (address ucat,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "U",
                symbol: "U",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 20_000e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _buy(alice, ucat, address(usdc), 5_000e6);
        uint256 acc = buyback.accrued(address(usdc));
        assertGt(acc, 0);

        // Crash CORE by buying a huge amount with USDC (CORE becomes expensive).
        usdc.approve(address(router), 4_000_000e6);
        bool zfo = address(usdc) < address(core);
        router.swap(coreKey, zfo, -int256(4_000_000e6), 1, address(this));

        uint256 accBefore = buyback.accrued(address(usdc));
        vm.prank(alice);
        vm.expectRevert();
        buyback.execute(address(usdc), _emptyHops(), 1);
        assertEq(buyback.accrued(address(usdc)), accBefore, "non-keeper cannot spend CORE pot");
    }

    function test_staleRefAndCooldown() public {
        (address ucat,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "U2",
                symbol: "U2",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 20_000e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _buy(alice, ucat, address(usdc), 5_000e6);
        _keeperCore(address(usdc));
        uint256 mid = buyback.accrued(address(usdc));
        vm.prank(keeper);
        vm.expectRevert();
        buyback.execute(address(usdc), _emptyHops(), 1);
        assertEq(buyback.accrued(address(usdc)), mid, "cooldown");
        vm.warp(block.timestamp + ReactorConstants.BUYBACK_COOLDOWN + 1);
        _keeperCore(address(usdc));
        assertLt(buyback.accrued(address(usdc)), mid);
    }

    function test_decimals618AndMultiMarketBurn() public {
        address zcat = _instantZcat(80_000e8);
        (address giga,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "GIGA",
                symbol: "GIGA",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 15_000e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        address meme = _instantPriced(
            ReactorFactory.InstantParams({
                name: "MEME",
                symbol: "MEME",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(btc),
                fdvQuoteRaw: 2e8,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            }),
            true
        );

        _buy(alice, zcat, address(zec), 4_000e8);
        _buy(bob, giga, address(usdc), 4_000e6);
        _buy(carol, meme, address(btc), 1e8);

        assertEq(ReactorToken(zcat).quoteAsset(), address(zec));
        assertEq(ReactorToken(giga).quoteAsset(), address(usdc));
        assertEq(ReactorToken(meme).quoteAsset(), address(btc));
        assertGt(buyback.accrued(address(zec)), 0);
        assertGt(buyback.accrued(address(usdc)), 0);
        assertGt(buyback.accrued(address(btc)), 0);

        uint256 burnedBefore = buyback.lifetimeBurned();
        uint256 supplyBefore = core.totalSupply();
        _keeperCore(address(usdc));
        vm.warp(block.timestamp + ReactorConstants.BUYBACK_COOLDOWN + 1);
        _keeperCore(address(zec));
        vm.warp(block.timestamp + ReactorConstants.BUYBACK_COOLDOWN + 1);
        _keeperCore(address(btc));
        assertGt(buyback.lifetimeBurned(), burnedBefore);
        assertLt(core.totalSupply(), supplyBefore);
    }

    function test_fairEarlyClaimerDoesNotSteal() public {
        (address token, uint256 fairId) = factory.createFairLaunch(
            ReactorFactory.FairParams({
                name: "FairDuo",
                symbol: "FDUO",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(zec),
                duration: 45 minutes,
                auctionBps: 5_000,
                minRaise: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        vm.startPrank(alice);
        zec.approve(address(factory), 1_000e8);
        factory.bid(fairId, 1_000e8);
        vm.stopPrank();
        vm.startPrank(bob);
        zec.approve(address(factory), 1_000e8);
        factory.bid(fairId, 1_000e8);
        vm.stopPrank();
        vm.warp(block.timestamp + 46 minutes);
        factory.finalizeFairLaunch(fairId);

        vm.prank(alice);
        uint256 aliceTok = factory.claimFairTokens(fairId, alice);
        assertGt(aliceTok, 0);
        assertGt(ReactorToken(token).balanceOf(alice), 0);
        assertGt(ReactorToken(token).balanceOf(address(factory.fairVault())), 0);
        _buy(carol, token, address(zec), 4_000e8);

        uint256 alicePending = ReactorToken(token).pendingRewards(alice);
        uint256 vaultPending = ReactorToken(token).pendingRewards(address(factory.fairVault()));
        uint256 leftover = ReactorToken(token).leftoverRewards();
        assertGt(alicePending + vaultPending + leftover, 0, "post-launch rewards vanished");
        assertGt(vaultPending + leftover, 0, "vault share missing");

        vm.prank(bob);
        uint256 bobTok = factory.claimFairTokens(fairId, bob);
        assertEq(aliceTok, bobTok);
        uint256 bobQuote = IERC20Like(address(zec)).balanceOf(bob);
        // Bob's physical claim pays vault-held quote. Alice cannot have emptied it.
        assertGt(ReactorToken(token).balanceOf(bob), 0);
        assertLt(ReactorToken(token).pendingRewards(address(factory.fairVault())), 2);
        // Neither winner ends with both auction piles.
        assertEq(ReactorToken(token).balanceOf(alice), aliceTok);
        assertEq(ReactorToken(token).balanceOf(bob), bobTok);
        bobQuote;
    }

    function test_fairAuctionBpsLockedAndPriceContinuity() public {
        vm.expectRevert(ReactorFactory.AuctionBpsLocked.selector);
        factory.createFairLaunch(
            ReactorFactory.FairParams({
                name: "Bad",
                symbol: "BAD",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(zec),
                duration: 45 minutes,
                auctionBps: 4_000,
                minRaise: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function test_repeatFinalizeReverts() public {
        (, uint256 fairId) = factory.createFairLaunch(
            ReactorFactory.FairParams({
                name: "R",
                symbol: "R",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(zec),
                duration: 1,
                auctionBps: 5_000,
                minRaise: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        vm.startPrank(alice);
        zec.approve(address(factory), 100e8);
        factory.bid(fairId, 100e8);
        vm.stopPrank();
        vm.warp(block.timestamp + 2);
        factory.finalizeFairLaunch(fairId);
        vm.expectRevert(ReactorFactory.AlreadyFinalized.selector);
        factory.finalizeFairLaunch(fairId);
    }

    function test_doubleClaimAndHistoricTheft() public {
        address token = _instantZcat(40_000e8);
        _buy(alice, token, address(zec), 2_000e8);
        uint256 pending = ReactorToken(token).pendingRewards(alice);
        vm.prank(alice);
        assertEq(ReactorToken(token).claimRewards(alice), pending);
        vm.prank(alice);
        assertEq(ReactorToken(token).claimRewards(alice), 0);
        uint256 bal = ReactorToken(token).balanceOf(alice);
        vm.prank(alice);
        ReactorToken(token).transfer(bob, bal);
        _buy(carol, token, address(zec), 1_000e8);
        assertEq(ReactorToken(token).pendingRewards(alice), 0);
    }

    function test_transferBeforeAfterFeeNoTax() public {
        address token = _instantZcat(40_000e8);
        _buy(alice, token, address(zec), 1_000e8);
        uint256 bal = ReactorToken(token).balanceOf(alice);
        vm.prank(alice);
        ReactorToken(token).transfer(bob, bal / 2);
        assertEq(ReactorToken(token).balanceOf(bob), bal / 2);
        _buy(carol, token, address(zec), 500e8);
        vm.prank(bob);
        ReactorToken(token).transfer(alice, bal / 4);
        assertEq(ReactorToken(token).balanceOf(alice) + ReactorToken(token).balanceOf(bob), bal);
    }

    function test_buybackReentrancyGuarded() public {
        address token = _instantZcat(80_000e8);
        _buy(alice, token, address(zec), 8_000e8);
        vm.prank(alice);
        vm.expectRevert();
        buyback.execute(address(zec), _hop(address(zec), address(usdc), zecUsdcKey), 1);
        _keeperCore(address(zec));
        assertGt(buyback.lifetimeBurned(), 0);
    }

    function test_flashLiquidityCannotUnlock() public {
        address token = _instantZcat(40_000e8);
        PoolKey memory key = _key(token, address(zec));
        vm.expectRevert(ReactorLiquidityVault.NotFactory.selector);
        vault.lockLiquidity(key, -60, 60, -1);
    }
}

