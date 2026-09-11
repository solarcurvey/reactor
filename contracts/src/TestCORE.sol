// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CoreToken} from "./CoreToken.sol";

/// @notice Deprecated alias for `CoreToken` (REACTOR CORE / CORE). Tokenomics unchanged.
contract TestCORE is CoreToken {
    constructor(address genesisAuthority_) CoreToken(genesisAuthority_) {}
}
