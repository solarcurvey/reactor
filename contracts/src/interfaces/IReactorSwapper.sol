// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";

interface IReactorSwapper {
    function swap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut);

    function protocolSwap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut);
}
