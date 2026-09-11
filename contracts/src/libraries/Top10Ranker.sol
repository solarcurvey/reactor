// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Offchain ranker used by REACTOR API (~every 5 minutes). Never guesses a mark.
/// Fail-closed only on MATERIAL uncertainty — a dead low-value graduate with <3 trades
/// must not freeze every epoch. See TESTING.md / AUDIT_HANDOFF.
library Top10Ranker {
    struct Candidate {
        address token;
        bool graduated;
        bool isCore;
        uint256 markUsdc;
        bool markOk;
        uint256 lastGoodMarkUsdc;
        uint256 liquidityUsdc;
        uint256 windowVolumeUsdc;
        uint256 tradeCount;
        bool priorRanked;
    }

    function cand(address token, bool graduated, bool isCore, uint256 markUsdc, bool markOk)
        internal
        pure
        returns (Candidate memory c)
    {
        c.token = token;
        c.graduated = graduated;
        c.isCore = isCore;
        c.markUsdc = markUsdc;
        c.markOk = markOk;
    }

    /// @notice Could this name plausibly change the Top-10 if we guessed a mark?
    function materialUncertainty(Candidate memory c, uint256 floorUsdc) internal pure returns (bool) {
        if (c.priorRanked) return true;
        if (c.lastGoodMarkUsdc >= floorUsdc) return true;
        if (c.liquidityUsdc >= floorUsdc / 5) return true;
        if (c.windowVolumeUsdc >= floorUsdc / 10 && c.lastGoodMarkUsdc >= floorUsdc / 2) return true;
        return false;
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
        for (uint256 i; i < n; i++) {
            Candidate memory c = cands[i];
            if (c.isCore || !c.graduated) continue;
            if (!c.markOk) {
                if (materialUncertainty(c, floorUsdc)) {
                    return (new address[](0), new uint256[](0), true);
                }
                continue;
            }
            if (c.markUsdc < floorUsdc) continue;
            tok[m] = c.token;
            marks[m] = c.markUsdc;
            m++;
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
