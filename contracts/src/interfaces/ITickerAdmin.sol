// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ITickerAdmin {
    function permanentlyLockTicker(string calldata ticker, address canonicalToken) external;
    function authorizeFactory(address factory, uint32 version) external;
    function deprecateFactory(address factory) external;
}
