// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Base} from "../Base.sol";
import {RouteGuard} from "../../src/libraries/RouteGuard.sol";
import {RouteExec} from "../../src/libraries/RouteExec.sol";
import {IRouteAdapter} from "../../src/interfaces/IRouteAdapter.sol";
import {IERC20MinimalExt} from "../../src/interfaces/IERC20MinimalExt.sol";
import {UniswapV4Adapter} from "../../src/adapters/UniswapV4Adapter.sol";

/// @notice Lying adapters fail; arbitrary v4 hooks denied; hop/cycle bounds.
contract RoutingDeltasTest is Base {
    function test_lyingAdapter_balanceDeltaFails() public {
        LyingAdapter liar = new LyingAdapter();
        auth.setAdapter(address(liar), true);
        zec.mint(address(flywheel), 1_000e8);
        vm.prank(address(hook));
        flywheel.accrue(address(zec), 1_000e8);

        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](1);
        hops[0] = RouteGuard.Hop({
            adapter: address(liar),
            tokenIn: address(zec),
            tokenOut: address(usdc),
            minOut: 1,
            data: ""
        });
        vm.prank(keeper);
        vm.expectRevert(RouteExec.DeltaOut.selector);
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_arbitraryHookDenied() public {
        PoolKey memory bad = zecUsdcKey;
        bad.hooks = IHooks(address(0xBEEF));
        zec.mint(address(flywheel), 1_000e8);
        vm.prank(address(hook));
        flywheel.accrue(address(zec), 1_000e8);
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](1);
        hops[0] = RouteGuard.Hop({
            adapter: address(v4Adapter),
            tokenIn: address(zec),
            tokenOut: address(usdc),
            minOut: 1,
            data: abi.encode(bad)
        });
        vm.prank(keeper);
        vm.expectRevert(UniswapV4Adapter.HookDenied.selector);
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_tooManyHopsReverts() public {
        zec.mint(address(flywheel), 1_000e8);
        vm.prank(address(hook));
        flywheel.accrue(address(zec), 1_000e8);
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](4);
        for (uint256 i; i < 4; i++) {
            hops[i] = RouteGuard.Hop({
                adapter: address(v4Adapter),
                tokenIn: i == 0 ? address(zec) : address(uint160(i + 10)),
                tokenOut: address(uint160(i + 11)),
                minOut: 1,
                data: ""
            });
        }
        hops[3].tokenOut = address(usdc);
        vm.prank(keeper);
        vm.expectRevert(RouteGuard.TooManyHops.selector);
        flywheel.settleQuote(address(zec), hops, 1);
    }

    function test_cycleHopsRevert() public {
        RouteGuard.Hop[] memory hops = new RouteGuard.Hop[](3);
        hops[0] = RouteGuard.Hop({
            adapter: address(v4Adapter),
            tokenIn: address(zec),
            tokenOut: address(btc),
            minOut: 1,
            data: ""
        });
        hops[1] = RouteGuard.Hop({
            adapter: address(v4Adapter),
            tokenIn: address(btc),
            tokenOut: address(zec),
            minOut: 1,
            data: ""
        });
        hops[2] = RouteGuard.Hop({
            adapter: address(v4Adapter),
            tokenIn: address(zec),
            tokenOut: address(usdc),
            minOut: 1,
            data: ""
        });
        zec.mint(address(flywheel), 1_000e8);
        vm.prank(address(hook));
        flywheel.accrue(address(zec), 1_000e8);
        vm.prank(keeper);
        vm.expectRevert(RouteGuard.Cycle.selector);
        flywheel.settleQuote(address(zec), hops, 1);
    }
}

contract LyingAdapter is IRouteAdapter {
    function swapExactIn(address tokenIn, address, uint256 amountIn, uint256, address, bytes calldata)
        external
        returns (uint256)
    {
        IERC20MinimalExt(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        return type(uint256).max;
    }
}
