// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Offchain ranker used by REACTOR API (~every 5 minutes). Never guesses a mark.
library Top10Ranker {
    struct Candidate {
        address token;
        bool graduated;
        bool isCore;
        uint256 markUsdc;
        bool markOk;
    }

    function rank(Candidate[] memory cands, uint256 floorUsdc)
        internal
        pure
        returns (address[] memory tokens, uint256[] memory weights, bool pauseEpoch)
    {
        uint256 n = cands.length;
        address[] memory tok = new address[](n);
        uint256[] memory marks = new uint256[](n);
        uint256 m;
        bool sawUnreliable;
        for (uint256 i; i < n; i++) {
            Candidate memory c = cands[i];
            if (c.isCore || !c.graduated) continue;
            if (!c.markOk) {
                sawUnreliable = true;
                continue;
            }
            if (c.markUsdc < floorUsdc) continue;
            tok[m] = c.token;
            marks[m] = c.markUsdc;
            m++;
        }
        if (sawUnreliable && m == 0) {
            return (new address[](0), new uint256[](0), true);
        }
        for (uint256 a; a < m; a++) {
            uint256 best = a;
            for (uint256 b = a + 1; b < m; b++) {
                if (marks[b] > marks[best]) best = b;
            }
            (tok[a], tok[best]) = (tok[best], tok[a]);
            (marks[a], marks[best]) = (marks[best], marks[a]);
        }
        uint256 filled = m > 10 ? 10 : m;
        tokens = new address[](filled);
        weights = new uint256[](filled);
        uint256 sum;
        for (uint256 i; i < filled; i++) {
            tokens[i] = tok[i];
            sum += marks[i];
        }
        if (filled == 0) return (tokens, weights, false);
        uint256 acc;
        for (uint256 i; i < filled; i++) {
            if (i == filled - 1) {
                weights[i] = 10_000 - acc;
            } else {
                weights[i] = (marks[i] * 10_000) / sum;
                acc += weights[i];
            }
        }
        pauseEpoch = false;
    }
}
