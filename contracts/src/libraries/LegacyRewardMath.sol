// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Frozen copy of the pre-fix reward model for regression only.
/// Uncapped `acc += (dist * P) / S` plus `debt = floor(bal * acc / P)`
/// over-assigns when eligible supply changes and leftover is re-flushed.
library LegacyRewardMath {
    uint256 internal constant P = 1e27;

    struct State {
        uint256 acc;
        uint256 leftover;
        uint256 lifetime;
        uint256 excludedBalance;
        uint256 totalSupply;
        mapping(address => uint256) balanceOf;
        mapping(address => bool) excluded;
        mapping(address => uint256) debt;
        mapping(address => uint256) stored;
        mapping(address => uint256) claimed;
    }

    function credit(State storage s, uint256 amount) internal {
        if (amount == 0) return;
        s.lifetime += amount;
        uint256 dist = amount + s.leftover;
        uint256 supply = _eligible(s);
        if (supply == 0) {
            s.leftover = dist;
            return;
        }
        uint256 increment = (dist * P) / supply;
        s.acc += increment;
        s.leftover = dist - (increment * supply) / P;
    }

    function flushLeftover(State storage s) internal {
        uint256 dist = s.leftover;
        uint256 supply = _eligible(s);
        if (dist == 0 || supply == 0) return;
        uint256 increment = (dist * P) / supply;
        s.acc += increment;
        s.leftover = dist - (increment * supply) / P;
    }

    function transfer(State storage s, address from, address to, uint256 amount) internal {
        _accrue(s, from);
        _accrue(s, to);
        s.balanceOf[from] -= amount;
        s.balanceOf[to] += amount;
        if (s.excluded[from] && !s.excluded[to]) s.excludedBalance -= amount;
        else if (!s.excluded[from] && s.excluded[to]) s.excludedBalance += amount;
        _sync(s, from);
        _sync(s, to);
        flushLeftover(s);
    }

    function pending(State storage s, address a) internal view returns (uint256) {
        return s.stored[a] + _unpaid(s, a);
    }

    function claim(State storage s, address a) internal returns (uint256 amt) {
        _accrue(s, a);
        _sync(s, a);
        amt = s.stored[a];
        s.stored[a] = 0;
        s.claimed[a] += amt;
    }

    function _eligible(State storage s) private view returns (uint256) {
        return s.excludedBalance >= s.totalSupply ? 0 : s.totalSupply - s.excludedBalance;
    }

    function _accrue(State storage s, address a) private {
        if (s.excluded[a]) return;
        uint256 u = _unpaid(s, a);
        if (u > 0) s.stored[a] += u;
    }

    function _sync(State storage s, address a) private {
        if (s.excluded[a]) {
            s.debt[a] = 0;
            return;
        }
        s.debt[a] = (s.balanceOf[a] * s.acc) / P;
    }

    function _unpaid(State storage s, address a) private view returns (uint256) {
        if (s.excluded[a]) return 0;
        uint256 accumulated = (s.balanceOf[a] * s.acc) / P;
        uint256 debt = s.debt[a];
        return accumulated > debt ? accumulated - debt : 0;
    }
}
