// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";

/// @notice Arc-compatible smoke: chain id 5042002 and 6-decimal quote math.
contract ArcSmokeTest is Base {
    function test_arcChainIdAndUsdcDecimals() public {
        vm.chainId(5042002);
        assertEq(block.chainid, 5042002);
        assertEq(usdc.decimals(), 6);
        address token = _instantZcat(25_000e8);
        assertTrue(token != address(0));
    }
}
