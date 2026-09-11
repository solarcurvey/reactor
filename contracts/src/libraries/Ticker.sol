// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Shared ticker normalize. Same rules as `packages/reactor/src/ticker.ts`.
/// Canonical form: uppercase ASCII A–Z / 0–9, length 1..MAX_LEN.
/// No Unicode, whitespace, punctuation, or confusables — rejected, not mapped.
library Ticker {
    uint256 internal constant MAX_LEN = 10;
    uint64 internal constant LOCK_SECONDS = 24 hours;

    error BadTicker();

    function normalize(string memory raw) internal pure returns (string memory out) {
        bytes memory b = bytes(raw);
        uint256 n = b.length;
        if (n == 0 || n > MAX_LEN) revert BadTicker();
        bytes memory o = new bytes(n);
        for (uint256 i; i < n; i++) {
            uint8 c = uint8(b[i]);
            if (c >= 0x61 && c <= 0x7a) c -= 32; // a-z → A-Z
            bool ok = (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39);
            if (!ok) revert BadTicker();
            o[i] = bytes1(c);
        }
        out = string(o);
    }

    function key(string memory raw) internal pure returns (bytes32) {
        return keccak256(bytes(normalize(raw)));
    }

    function hashCanonical(string memory canonical) internal pure returns (bytes32) {
        return keccak256(bytes(canonical));
    }
}
