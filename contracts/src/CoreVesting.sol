// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorConstants} from "./ReactorConstants.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";

/// @notice Immutable 100M CORE vest. T0 = public REACTOR launch (not necessarily deploy).
///         30-day cliff with zero unlock at day 30, then 10×30-day linear. Claim only to beneficiary.
contract CoreVesting {
    address public constant BENEFICIARY = ReactorConstants.CORE_VESTING_BENEFICIARY;
    uint256 public constant TOTAL = ReactorConstants.CORE_VESTING_AMOUNT;
    uint64 public constant CLIFF = ReactorConstants.CORE_CLIFF;
    uint64 public constant DURATION = ReactorConstants.CORE_VEST_DURATION;

    address public immutable core;
    ReactorGuardian public immutable auth;
    uint64 public t0;
    uint256 public claimed;

    event LaunchActivated(uint64 t0);
    event Claimed(uint256 amount);

    error NotGuardian();
    error Frozen();
    error NotBeneficiary();
    error NothingDue();

    /// @param t0Init If nonzero, T0 is frozen at construct (prod). If zero, Guardian `activateLaunch` once.
    constructor(address core_, ReactorGuardian auth_, uint64 t0Init) {
        if (core_ == address(0) || address(auth_) == address(0)) revert Frozen();
        core = core_;
        auth = auth_;
        if (t0Init != 0) {
            t0 = t0Init;
            emit LaunchActivated(t0Init);
        }
    }

    /// @notice One-time T0 = now. Public REACTOR launch, not deploy time. Then frozen forever.
    function activateLaunch() external {
        if (!auth.isGuardian(msg.sender)) revert NotGuardian();
        if (t0 != 0) revert Frozen();
        t0 = uint64(block.timestamp);
        emit LaunchActivated(t0);
    }

    function vested() public view returns (uint256) {
        if (t0 == 0) return 0;
        uint256 start = uint256(t0) + CLIFF;
        if (block.timestamp <= start) return 0;
        uint256 elapsed = block.timestamp - start;
        if (elapsed >= DURATION) return TOTAL;
        return (TOTAL * elapsed) / DURATION;
    }

    function claimable() public view returns (uint256) {
        uint256 v = vested();
        return v > claimed ? v - claimed : 0;
    }

    function claim() external {
        if (msg.sender != BENEFICIARY) revert NotBeneficiary();
        uint256 due = claimable();
        if (due == 0) revert NothingDue();
        claimed += due;
        IERC20MinimalExt(core).transfer(BENEFICIARY, due);
        emit Claimed(due);
    }
}
