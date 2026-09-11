// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";
import {ProtocolV4Adapter} from "../../src/adapters/ProtocolV4Adapter.sol";

/// @notice Nested Flywheel settle via ProtocolV4Adapter must not mint 2/1/0.5. Same user trade pays 3.5%.
contract ProtocolSettlementTest is Base {
    function test_protocolFlywheelNestedCreatesZeroNewFees() public {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);
        assertTrue(curve.graduatedOf(zcat));

        uint256 zcatAmt = 5_000 ether;
        deal(zcat, address(flywheel), zcatAmt);
        vm.prank(address(hook));
        flywheel.accrue(zcat, zcatAmt);

        uint256 fly0 = flywheel.lifetimeAccrued();
        uint256 sb0 = selfBurn.lifetimeAccrued();
        uint256 bb0 = buyback.lifetimeAccrued();
        uint256 flyBal0 = flywheel.quoteAccrued(address(zec));
        uint256 bbZec0 = buyback.accrued(address(zec));

        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](2);
        hops[0] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: zcat,
            tokenOut: address(zec),
            minOut: 1,
            data: abi.encode(_key(zcat, address(zec)))
        });
        hops[1] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: address(zec),
            tokenOut: address(usdc),
            minOut: 1,
            data: abi.encode(zecUsdcKey)
        });

        vm.prank(keeper);
        flywheel.settleQuote(zcat, hops, 1);

        assertEq(flywheel.lifetimeAccrued(), fly0, "protocol settle must not accrue flywheel");
        assertEq(selfBurn.lifetimeAccrued(), sb0, "protocol settle must not accrue self-burn");
        assertEq(buyback.lifetimeAccrued(), bb0, "protocol settle must not accrue CORE pot");
        assertEq(flywheel.quoteAccrued(address(zec)), flyBal0);
        assertEq(buyback.accrued(address(zec)), bbZec0);
        assertGt(flywheel.usdcPot(), 0);
    }

    function test_sameUserTradePays35() public {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);

        uint256 fly0 = flywheel.lifetimeAccrued();
        uint256 bb0 = buyback.lifetimeAccrued();

        uint256 zecIn = 200e8;
        uint256 out = _buy(bob, zcat, address(zec), zecIn);
        assertGt(out, 0);

        uint256 expectedFly = (zecIn * 100) / 10_000;
        uint256 expectedCore = (zecIn * 50) / 10_000;
        assertEq(flywheel.lifetimeAccrued() - fly0, expectedFly);
        assertEq(buyback.lifetimeAccrued() - bb0, expectedCore);
    }

    function test_userRouteCannotUseProtocolAdapter() public {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);

        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](1);
        hops[0] = RouteGuard.Hop({
            adapter: address(protocolAdapter),
            tokenIn: address(usdc),
            tokenOut: address(zec),
            minOut: 1,
            data: abi.encode(zecUsdcKey)
        });
        vm.startPrank(bob);
        usdc.approve(address(userRouter), 50e6);
        vm.expectRevert(ProtocolV4Adapter.NotExecutor.selector);
        userRouter.buy(zcat, 50e6, hops, 1, block.timestamp + 60);
        vm.stopPrank();
    }

    function test_keeperEoaCannotCallProtocolAdapter() public {
        vm.prank(keeper);
        vm.expectRevert(ProtocolV4Adapter.NotExecutor.selector);
        protocolAdapter.swapExactIn(address(usdc), address(zec), 1e6, 1, keeper, abi.encode(zecUsdcKey));
    }

    function test_userAdapterPaysFeesOnOfficialLeg() public {
        address zcat = _instantZcat(1);
        _fillAndGraduate(alice, zcat);

        uint256 fly0 = flywheel.lifetimeAccrued();
        zec.mint(address(this), 200e8);
        zec.approve(address(v4Adapter), 200e8);
        v4Adapter.swapExactIn(
            address(zec), zcat, 200e8, 1, address(this), abi.encode(_key(zcat, address(zec)))
        );
        assertGt(flywheel.lifetimeAccrued(), fly0);
    }
}
