// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Base, IERC20Like} from "../Base.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";

/// @notice Handler for stateful Foundry invariant campaigns (not a unit test).
contract RewardHandler {
    Base internal b;
    address[] public tokens;
    address[] public actors;
    uint256 public ghostAccruedHolders;
    uint256 public ghostClaims;

    constructor(Base b_) {
        b = b_;
        actors.push(b.alice());
        actors.push(b.bob());
        actors.push(b.carol());
    }

    function _token(uint256 i) internal view returns (address) {
        if (tokens.length == 0) return address(0);
        return tokens[i % tokens.length];
    }

    function launchInstant(uint8 which) external {
        if (tokens.length > 4) return;
        address quote = which % 2 == 0 ? address(b.zec()) : address(b.usdc());
        uint256 fdv = quote == address(b.zec()) ? 40_000e8 : 12_000e6;
        (address token,) = b.factory()
            .instantLaunch(
                ReactorFactory.InstantParams({
                    name: "INV",
                    symbol: "INV",
                    decimals: 18,
                    supply: 1_000_000_000 ether,
                    quote: quote,
                    fdvQuoteRaw: fdv,
                    devBuyQuote: 0,
                    image: "",
                    description: "",
                    website: "",
                    twitter: "",
                    telegram: ""
                })
            );
        tokens.push(token);
    }

    function buy(uint256 tokI, uint256 actorI, uint256 amt) external {
        address token = _token(tokI);
        if (token == address(0)) return;
        address who = actors[actorI % actors.length];
        address quote = ReactorToken(token).quoteAsset();
        uint256 maxIn = quote == address(b.zec()) ? 200e8 : 200e6;
        amt = boundAmt(amt, 10, maxIn);
        try this.doBuy(who, token, quote, amt) {} catch {}
    }

    function doBuy(address who, address token, address quote, uint256 amt) external {
        b._buy(who, token, quote, amt);
    }

    function sell(uint256 tokI, uint256 actorI, uint256 bps) external {
        address token = _token(tokI);
        if (token == address(0)) return;
        address who = actors[actorI % actors.length];
        uint256 bal = ReactorToken(token).balanceOf(who);
        if (bal < 1e15) return;
        uint256 amt = (bal * boundAmt(bps, 1, 5_000)) / 10_000;
        if (amt == 0) return;
        address quote = ReactorToken(token).quoteAsset();
        try this.doSell(who, token, quote, amt) {} catch {}
    }

    function doSell(address who, address token, address quote, uint256 amt) external {
        b._sell(who, token, quote, amt);
    }

    function transfer(uint256 tokI, uint256 fromI, uint256 toI, uint256 bps) external {
        address token = _token(tokI);
        if (token == address(0)) return;
        address from = actors[fromI % actors.length];
        address to = actors[toI % actors.length];
        uint256 bal = ReactorToken(token).balanceOf(from);
        if (bal == 0) return;
        uint256 amt = (bal * boundAmt(bps, 1, 10_000)) / 10_000;
        if (amt == 0) return;
        vmPrank(from);
        try ReactorToken(token).transfer(to, amt) {} catch {}
    }

    function claim(uint256 tokI, uint256 actorI) external {
        address token = _token(tokI);
        if (token == address(0)) return;
        address who = actors[actorI % actors.length];
        vmPrank(who);
        try ReactorToken(token).claimRewards(who) returns (uint256 got) {
            ghostClaims += got;
        } catch {}
    }

    function flush(uint256 tokI) external {
        address token = _token(tokI);
        if (token == address(0)) return;
        try b.hook().flush(token) {} catch {}
    }

    function buybackExec(uint256 which) external {
        address q = which % 2 == 0 ? address(b.usdc()) : address(b.zec());
        RouteGuard.Hop[] memory hops;
        try b.buyback().execute(q, hops, 1) {} catch {}
    }

    function tokensLength() external view returns (uint256) {
        return tokens.length;
    }

    function tokenAt(uint256 i) external view returns (address) {
        return tokens[i];
    }

    function boundAmt(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (hi <= lo) return lo;
        return lo + (x % (hi - lo + 1));
    }

    function vmPrank(address a) internal {
        (bool ok,) =
            address(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D).call(abi.encodeWithSignature("prank(address)", a));
        ok;
    }
}

contract RewardCampaignTest is Base {
    RewardHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new RewardHandler(this);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](7);
        sels[0] = RewardHandler.launchInstant.selector;
        sels[1] = RewardHandler.buy.selector;
        sels[2] = RewardHandler.sell.selector;
        sels[3] = RewardHandler.transfer.selector;
        sels[4] = RewardHandler.claim.selector;
        sels[5] = RewardHandler.flush.selector;
        sels[6] = RewardHandler.buybackExec.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    function invariant_solvencyAndEntitlement() public view {
        uint256 n = handler.tokensLength();
        for (uint256 i = 0; i < n; i++) {
            address token = handler.tokenAt(i);
            address quote = ReactorToken(token).quoteAsset();
            uint256 outstanding = ReactorToken(token).pendingRewards(alice) + ReactorToken(token).pendingRewards(bob)
                + ReactorToken(token).pendingRewards(carol)
                + ReactorToken(token).pendingRewards(address(factory.fairVault()))
                + ReactorToken(token).leftoverRewards();
            uint256 backing = IERC20Like(quote).balanceOf(token) + hook.pendingTokenRewards(token);
            // Magnified DPS: leftover is unassigned carry-forward, never allocated twice.
            assertLe(outstanding, backing);
            assertLe(outstanding, ReactorToken(token).lifetimeRewards());
        }
    }
}
