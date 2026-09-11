// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {InstantCurve, IInstantFactory} from "../../src/InstantCurve.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";

/// @notice P0: public trust-by-prefunding. Exploit reproduced on HEAD 844255e
/// (`test_reproduce_buyPrefunded_drainsAliceQuote` minted ZCAT / inflated realQuote
/// with attacker holding 0 ZEC). That selector is deleted. Same attack now reverts.
contract BuyPrefundedDrainTest is Base {
    address internal attacker;

    function setUp() public override {
        super.setUp();
        attacker = makeAddr("attacker");
    }

    function test_reproduce_publicPrefunded_oldSelectorGone() public {
        address zcat = _aliceBond();
        uint256 real0 = curve.realQuoteOf(zcat);
        uint256 curveZec0 = zec.balanceOf(address(curve));
        assertEq(zec.balanceOf(attacker), 0, "attacker holds 0 ZEC");

        (bool ok,) = address(curve)
            .call(
                abi.encodeWithSignature(
                    "buyPrefunded(address,address,uint256,uint256)", zcat, attacker, uint256(10e8), uint256(1)
                )
            );
        assertFalse(ok, "old public prefunded selector must not exist");
        assertEq(curve.realQuoteOf(zcat), real0, "realQuote unchanged");
        assertEq(zec.balanceOf(address(curve)), curveZec0, "curve ZEC inventory unchanged");
        assertEq(ReactorToken(zcat).balanceOf(attacker), 0, "attacker gets 0 ZCAT");
    }

    function test_exploit_buyRouted_unauthorizedReverts_noMint() public {
        address zcat = _aliceBond();
        uint256 real0 = curve.realQuoteOf(zcat);
        uint256 curveZec0 = zec.balanceOf(address(curve));

        vm.prank(attacker);
        vm.expectRevert(InstantCurve.NotRouter.selector);
        curve.buyRouted(zcat, attacker, 10e8, 1);

        assertEq(curve.realQuoteOf(zcat), real0);
        assertEq(zec.balanceOf(address(curve)), curveZec0);
        assertEq(ReactorToken(zcat).balanceOf(attacker), 0);
    }

    function test_exploit_executorWithoutQuoteReverts() public {
        address zcat = _aliceBond();
        uint256 real0 = curve.realQuoteOf(zcat);
        uint256 curveZec0 = zec.balanceOf(address(curve));

        vm.prank(address(userRouter));
        vm.expectRevert();
        curve.buyRouted(zcat, attacker, 10e8, 1);

        assertEq(curve.realQuoteOf(zcat), real0);
        assertEq(zec.balanceOf(address(curve)), curveZec0);
        assertEq(ReactorToken(zcat).balanceOf(attacker), 0);
    }

    function test_exploit_preexistingExcessQuoteCannotBeConsumed() public {
        address zcat = _aliceBond();
        uint256 real0 = curve.realQuoteOf(zcat);
        uint256 donate = 25e8;
        zec.mint(address(curve), donate);
        uint256 curveZec0 = zec.balanceOf(address(curve));
        assertGt(curveZec0, real0);

        vm.prank(attacker);
        vm.expectRevert(InstantCurve.NotRouter.selector);
        curve.buyRouted(zcat, attacker, donate, 1);

        vm.prank(address(userRouter));
        vm.expectRevert();
        curve.buyRouted(zcat, attacker, donate, 1);

        assertEq(curve.realQuoteOf(zcat), real0, "donated ZEC is not a buy");
        assertEq(zec.balanceOf(address(curve)), curveZec0);
        assertEq(ReactorToken(zcat).balanceOf(attacker), 0);
    }

    function test_buyRouted_honestExecutorPullsAndMints() public {
        address zcat = _aliceBond();
        uint256 real0 = curve.realQuoteOf(zcat);
        uint256 pay = 5e8;
        zec.mint(address(userRouter), pay);
        vm.prank(address(userRouter));
        zec.approve(address(curve), pay);

        uint256 beforeCurve = zec.balanceOf(address(curve));
        vm.prank(address(userRouter));
        uint256 out = curve.buyRouted(zcat, bob, pay, 1);
        assertGt(out, 0);
        assertEq(ReactorToken(zcat).balanceOf(bob), out);
        assertGt(curve.realQuoteOf(zcat), real0);
        assertGt(zec.balanceOf(address(curve)), beforeCurve);
        (,,, uint256 fee) = FeeMath.split(pay);
        assertEq(fee, (pay * 350) / 10_000);
    }

    function test_buyRouted_zeroRecipientReverts() public {
        address zcat = _aliceBond();
        uint256 pay = 4e8;
        zec.mint(address(userRouter), pay);
        vm.prank(address(userRouter));
        zec.approve(address(curve), pay);
        uint256 real0 = curve.realQuoteOf(zcat);
        vm.prank(address(userRouter));
        vm.expectRevert(InstantCurve.Bad.selector);
        curve.buyRouted(zcat, address(0), pay, 1);
        assertEq(curve.realQuoteOf(zcat), real0);
    }

    function test_buyRouted_maliciousRecipientDoesNotStealQuote() public {
        address zcat = _aliceBond();
        uint256 pay = 4e8;
        zec.mint(address(userRouter), pay);
        vm.prank(address(userRouter));
        zec.approve(address(curve), pay);
        MaliciousRecipient sink = new MaliciousRecipient(curve, zcat);
        uint256 real0 = curve.realQuoteOf(zcat);
        uint256 curveZec0 = zec.balanceOf(address(curve));
        vm.prank(address(userRouter));
        uint256 out = curve.buyRouted(zcat, address(sink), pay, 1);
        assertGt(out, 0);
        assertEq(ReactorToken(zcat).balanceOf(address(sink)), out);
        assertFalse(sink.stole());
        assertGt(curve.realQuoteOf(zcat), real0);
        assertGt(zec.balanceOf(address(curve)), curveZec0);
    }

    function test_buyRouted_reentrancyOnPullBlocked() public {
        ReenteringQuote q = new ReenteringQuote();
        q.mint(alice, 1_000_000e6);
        registry.register(address(q), "REQ", "Reentering Quote", 6, "", QuoteAssetRegistry.Category.Crypto);
        registry.setUsdPegOne(address(q), true);
        registry.setBuybackRoute(address(q), true, true);

        (address token,) = _instant(
            ReactorFactory.InstantParams({
                name: "RQ",
                symbol: "RQ",
                decimals: 18,
                supply: 0,
                quote: address(q),
                fdvQuoteRaw: 0,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        q.setAttack(curve, token, attacker);

        uint256 pay = 20_000e6;
        q.mint(address(userRouter), pay);
        vm.prank(address(userRouter));
        q.approve(address(curve), pay);

        uint256 real0 = curve.realQuoteOf(token);
        vm.prank(address(userRouter));
        uint256 out = curve.buyRouted(token, bob, pay, 1);
        assertGt(out, 0);
        assertTrue(q.reenteredTried());
        assertFalse(q.reenteredOk());
        assertEq(ReactorToken(token).balanceOf(attacker), 0);
        assertGt(curve.realQuoteOf(token), real0);
    }

    function test_userRouterBuy_nestedStillWorksAfterFix() public {
        address zcat = _instantZcat(1);
        vm.startPrank(bob);
        usdc.approve(address(userRouter), 200e6);
        uint256 out =
            userRouter.buy(zcat, 200e6, _hop(address(usdc), address(zec), zecUsdcKey), 1, block.timestamp + 60);
        vm.stopPrank();
        assertGt(out, 0);
        assertGt(ReactorToken(zcat).balanceOf(bob), 0);
    }

    function test_unboundExecutorRejectedUntilBound() public {
        InstantCurve fresh =
            new InstantCurve(IInstantFactory(address(factory)), hook, router, vault, registry, pm, auth);
        vm.expectRevert(InstantCurve.NotRouter.selector);
        fresh.buyRouted(address(usdc), attacker, 1, 1);
    }

    function _aliceBond() internal returns (address zcat) {
        zcat = _instantZcat(1);
        vm.startPrank(alice);
        zec.approve(address(curve), 50e8);
        curve.buy(zcat, 50e8, 1);
        vm.stopPrank();
    }
}

contract MaliciousRecipient {
    InstantCurve public immutable curve;
    address public immutable token;
    bool public stole;

    constructor(InstantCurve c, address t) {
        curve = c;
        token = t;
    }

    fallback() external {
        if (address(curve) != address(0)) {
            try curve.buyRouted(token, address(this), 1, 1) {
                stole = true;
            } catch {}
        }
    }
}

contract ReenteringQuote {
    string public name = "Reentering Quote";
    string public symbol = "REQ";
    uint8 public immutable decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    InstantCurve public victim;
    address public token;
    address public sneaker;
    bool public reenteredTried;
    bool public reenteredOk;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setAttack(InstantCurve c, address t, address s) external {
        victim = c;
        token = t;
        sneaker = s;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ALLOW");
            allowance[from][msg.sender] = allowed - amount;
        }
        if (address(victim) != address(0) && !reenteredTried) {
            reenteredTried = true;
            try victim.buyRouted(token, sneaker, 1e6, 1) {
                reenteredOk = true;
            } catch {}
            try victim.buy(token, 1e6, 1) {
                reenteredOk = true;
            } catch {}
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BAL");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
    }
}
