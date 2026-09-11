// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";

/// @notice Maintenance functions must return actual output so Keeper simulateContract().result works.
contract KeeperReturnsTest is Base {
    function test_selfBurnExecuteReturnsBurnedAmount() public {
        vm.prank(alice);
        (address token,) = factory.launchStandard(
            ReactorFactory.InstantParams({
                name: "SB",
                symbol: "SB",
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
        _buy(bob, token, address(usdc), 5_000e6);
        uint256 acc = selfBurn.accrued(token);
        assertGe(acc, 10_000);
        vm.prank(keeper);
        uint256 burned = selfBurn.execute(token, 1);
        assertGt(burned, 1, "Keeper minOut must be realistic, not dust");
        assertEq(selfBurn.lifetimeBurned(), burned);
    }

    function test_settleQuoteReturnsUsdcReceived() public {
        usdc.mint(address(flywheel), 50_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 50_000e6);
        vm.prank(keeper);
        uint256 got = flywheel.settleQuote(address(usdc), _emptyHops(), 0);
        assertEq(got, flywheel.usdcPot());
        assertGt(got, 0);
    }

    function test_settleNestedZecReturnsUsdc() public {
        zec.mint(address(flywheel), 1_000e8);
        vm.prank(address(hook));
        flywheel.accrue(address(zec), 1_000e8);
        vm.prank(keeper);
        uint256 got = flywheel.settleQuote(address(zec), _protocolHop(address(zec), address(usdc), zecUsdcKey), 1);
        assertGt(got, 1);
        assertEq(flywheel.usdcPot(), got);
    }

    function test_buybackExecuteReturnsCoreBought() public {
        usdc.mint(address(buyback), 20_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 20_000e6);
        vm.prank(keeper);
        uint256 coreOut = buyback.execute(address(usdc), _emptyHops(), 1);
        assertGt(coreOut, 1);
        assertEq(buyback.lifetimePurchased(), coreOut);
    }

    function test_top10BuybackReturnsTargetBought() public {
        (address token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "T10",
                symbol: "T10",
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
        _fillAndGraduate(alice, token);
        usdc.mint(address(flywheel), 10_000e6);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), 10_000e6);
        _keeperSettle(address(usdc));
        _submitTop10(token);
        vm.prank(keeper);
        uint256 burned = flywheel.executeTop10Buyback(token, _emptyHops(), 1);
        assertGt(burned, 1);
    }

    function test_lowSimulatedMinOutBlocksTx() public {
        usdc.mint(address(buyback), 20_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 20_000e6);
        vm.prank(keeper);
        uint256 honest = buyback.execute(address(usdc), _emptyHops(), 1);
        usdc.mint(address(buyback), 20_000e6);
        vm.prank(address(hook));
        buyback.accrue(address(usdc), 20_000e6);
        vm.warp(block.timestamp + 6 minutes);
        vm.prank(keeper);
        vm.expectRevert();
        buyback.execute(address(usdc), _emptyHops(), honest * 100);
    }
}
