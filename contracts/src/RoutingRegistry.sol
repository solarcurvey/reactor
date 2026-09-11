// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";

/// @notice Adapter table: executor chooses HOW (which registered route), not WHAT (destinations).
contract RoutingRegistry {
    address public immutable usdc;
    address public immutable owner;

    struct Route {
        address tokenIn;
        address tokenOut;
        address receiver;
        PoolKey key;
        bool exists;
        bool hookless;
    }

    mapping(bytes32 => Route) public routes;

    event RouteSet(bytes32 indexed id, address tokenIn, address tokenOut, address receiver);

    error NotOwner();
    error BadRoute();
    error UnknownRoute();

    constructor(address usdc_, address owner_) {
        usdc = usdc_;
        owner = owner_;
    }

    function routeId(address tokenIn, address tokenOut) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }

    function setRoute(address tokenIn, address tokenOut, address receiver, PoolKey calldata key) external {
        if (msg.sender != owner) revert NotOwner();
        if (tokenIn == address(0) || tokenOut == address(0) || receiver == address(0)) revert BadRoute();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (!((c0 == tokenIn && c1 == tokenOut) || (c0 == tokenOut && c1 == tokenIn))) revert BadRoute();
        if (address(key.hooks) != address(0) && tokenOut == usdc) revert BadRoute(); // hops to USDC must be hookless
        bytes32 id = routeId(tokenIn, tokenOut);
        routes[id] = Route({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            receiver: receiver,
            key: key,
            exists: true,
            hookless: address(key.hooks) == address(0)
        });
        emit RouteSet(id, tokenIn, tokenOut, receiver);
    }

    function getRoute(address tokenIn, address tokenOut) external view returns (Route memory) {
        Route memory r = routes[routeId(tokenIn, tokenOut)];
        if (!r.exists) revert UnknownRoute();
        return r;
    }

    function hasRoute(address tokenIn, address tokenOut) external view returns (bool) {
        return routes[routeId(tokenIn, tokenOut)].exists;
    }
}
