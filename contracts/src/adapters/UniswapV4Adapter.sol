// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IRouteAdapter} from "../interfaces/IRouteAdapter.sol";
import {IReactorSwapper} from "../interfaces/IReactorSwapper.sol";
import {IERC20MinimalExt} from "../interfaces/IERC20MinimalExt.sol";

/// @notice Uniswap v4 hop. Vaults approve this adapter; the Keeper EOA never receives allowance.
contract UniswapV4Adapter is IRouteAdapter {
    IReactorSwapper public immutable router;

    error BadPool();
    error NotPositive();

    constructor(IReactorSwapper router_) {
        router = router_;
    }

    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address recipient,
        bytes calldata data
    ) external returns (uint256 amountOut) {
        if (amountIn == 0 || minOut == 0) revert NotPositive();
        PoolKey memory key = abi.decode(data, (PoolKey));
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool in0 = c0 == tokenIn && c1 == tokenOut;
        bool in1 = c1 == tokenIn && c0 == tokenOut;
        if (!in0 && !in1) revert BadPool();

        IERC20MinimalExt(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20MinimalExt(tokenIn).approve(address(router), amountIn);
        amountOut = router.swap(key, in0, -int256(amountIn), minOut, recipient);
        IERC20MinimalExt(tokenIn).approve(address(router), 0);
    }
}
