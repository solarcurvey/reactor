// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorToken} from "./interfaces/IReactorToken.sol";

/// @notice Holds unclaimed Batch Fair Launch tokens as an eligible reward participant.
///         Claim is O(1): bidder takes tokens plus a pro-rata slice of quote already
///         accrued to this vault. Early claimers do not take later winners' share of
///         the remaining pile; they only take their slice of rewards earned so far.
contract FairClaimVault {
    address public immutable factory;

    error NotFactory();
    error Zero();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    constructor(address factory_) {
        if (factory_ == address(0)) revert Zero();
        factory = factory_;
    }

    function pullTo(address token, address to, uint256 amount) external onlyFactory {
        if (amount == 0) return;
        IERC20MinimalExt(token).transfer(to, amount);
    }

    function settleClaim(address token, address quote, uint256 userTokens, address to)
        external
        onlyFactory
        returns (uint256 quotePaid)
    {
        if (userTokens == 0) revert Zero();
        try IReactorToken(token).claimRewards(address(this)) {} catch {}
        uint256 tokBal = IERC20MinimalExt(token).balanceOf(address(this));
        if (userTokens > tokBal) revert Zero();
        uint256 qBal = IERC20MinimalExt(quote).balanceOf(address(this));
        quotePaid = tokBal == 0 ? 0 : (qBal * userTokens) / tokBal;
        IERC20MinimalExt(token).transfer(to, userTokens);
        if (quotePaid > 0) IERC20MinimalExt(quote).transfer(to, quotePaid);
    }
}
