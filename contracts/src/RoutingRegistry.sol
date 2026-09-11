// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "./ReactorGuardian.sol";

/// @notice View over Guardian-approved adapters. No path matrix. No owner.
///         Guardian calls `ReactorGuardian.setAdapter` to add or disable a reviewed adapter.
contract RoutingRegistry {
    ReactorGuardian public immutable auth;

    constructor(ReactorGuardian auth_) {
        auth = auth_;
    }

    function isApproved(address adapter) external view returns (bool) {
        return auth.adapterApproved(adapter);
    }
}
