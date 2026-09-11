// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Reviewed DEX adapter. Vaults approve this contract, never the Keeper EOA.
interface IRouteAdapter {
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address recipient,
        bytes calldata data
    ) external returns (uint256 amountOut);
}
