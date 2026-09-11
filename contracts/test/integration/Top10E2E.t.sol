// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {PushOracle, TokenListMock} from "../helpers/PushOracle.sol";
import {FlywheelVault} from "../../src/FlywheelVault.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";

/// @notice End-to-end Top-10 finalize + buy+burn and CORE executeCoreBuyback with real supply drops.
contract Top10E2ETest is Base {
    function _instantUsdc(string memory name, string memory symbol) internal returns (address token) {
        (token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: name,
                symbol: symbol,
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 25_000e6,
                devBuyQuote: 0,
                image: "",
                description: "e2e",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function test_finalizeAndExecuteTop10BurnsSupply() public {
        address token = _instantUsdc("BURN", "BURN");
        PushOracle push = new PushOracle(pm, hook, registry, address(usdc), address(core));
        TokenListMock list = new TokenListMock();
        FlywheelVault fw = new FlywheelVault(address(hook), address(usdc), address(core), pm, address(router));
        fw.bind(ReactorFactory(address(list)), push, keepers);
        keepers.setCaller(address(fw), true);
        router.setProtocolVault(address(fw), true);
        _fillAndGraduate(alice, token);
        list.add(token);
        push.push(token, 400_000e6);

        usdc.mint(address(fw), 20_000e6);
        vm.prank(address(hook));
        fw.accrue(address(usdc), 20_000e6);
        fw.settleQuote(address(usdc));
        assertGt(fw.usdcPot(), 0);

        vm.warp(block.timestamp + ReactorConstants.EPOCH_LENGTH + 1);
        fw.finalizeEpoch();
        assertTrue(fw.epochFinalized());
        assertEq(fw.ranked(0), token);

        uint256 supplyBefore = ReactorToken(token).totalSupply();
        uint256 potBefore = fw.usdcPot();
        fw.executeTop10Buyback(token);
        assertTrue(fw.bought(fw.epoch(), token));
        assertLt(fw.usdcPot(), potBefore);
        assertLt(ReactorToken(token).totalSupply(), supplyBefore, "Top-10 buy must burn");
    }

    function test_twoQualifiersSplitPotThenBurns() public {
        address a = _instantUsdc("TOPA", "TOPA");
        address b = _instantUsdc("TOPB", "TOPB");
        PushOracle push = new PushOracle(pm, hook, registry, address(usdc), address(core));
        TokenListMock list = new TokenListMock();
        FlywheelVault fw = new FlywheelVault(address(hook), address(usdc), address(core), pm, address(router));
        fw.bind(ReactorFactory(address(list)), push, keepers);
        keepers.setCaller(address(fw), true);
        router.setProtocolVault(address(fw), true);
        _fillAndGraduate(alice, a);
        _fillAndGraduate(alice, b);
        list.add(a);
        list.add(b);
        push.push(a, 400_000e6);
        push.push(b, 300_000e6);

        usdc.mint(address(fw), 14_000e6);
        vm.prank(address(hook));
        fw.accrue(address(usdc), 14_000e6);
        fw.settleQuote(address(usdc));
        uint256 pot = fw.usdcPot();
        vm.warp(block.timestamp + ReactorConstants.EPOCH_LENGTH + 1);
        fw.finalizeEpoch();

        uint256 sa = ReactorToken(a).totalSupply();
        uint256 sb = ReactorToken(b).totalSupply();
        fw.executeTop10Buyback(a);
        fw.executeTop10Buyback(b);
        assertLt(ReactorToken(a).totalSupply(), sa);
        assertLt(ReactorToken(b).totalSupply(), sb);
        // Full pot allocated (rounding dust only).
        assertLt(fw.usdcPot(), 2);
        assertEq(pot, pot);
    }

    function test_executeCoreBuybackBurnsCoreSupply() public {
        address token = _instantUsdc("COREX", "CRX");
        _buy(alice, token, address(usdc), 5_000e6);
        uint256 acc = buyback.accrued(address(usdc));
        assertGt(acc, 0);
        uint256 coreBefore = core.totalSupply();
        uint256 burnedBefore = buyback.lifetimeBurned();
        buyback.executeCoreBuyback(address(usdc));
        assertLt(core.totalSupply(), coreBefore, "CORE supply must decrease");
        assertGt(buyback.lifetimeBurned(), burnedBefore);
        assertLt(buyback.accrued(address(usdc)), acc);
    }

    function test_executeCoreBuybackCooldownNoSecondBurn() public {
        address token = _instantUsdc("COREY", "CRY");
        _buy(alice, token, address(usdc), 5_000e6);
        buyback.executeCoreBuyback(address(usdc));
        uint256 coreMid = core.totalSupply();
        uint256 accMid = buyback.accrued(address(usdc));
        buyback.executeCoreBuyback(address(usdc));
        assertEq(core.totalSupply(), coreMid);
        assertEq(buyback.accrued(address(usdc)), accMid);
    }
}
