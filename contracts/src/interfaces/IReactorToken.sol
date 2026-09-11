// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IReactorToken {
    function quoteAsset() external view returns (address);
    function creditRewards(uint256 amount) external;
    function claimRewards(address to) external returns (uint256);
    function pendingRewards(address account) external view returns (uint256);
    function eligibleSupply() external view returns (uint256);
}