// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IFeeSink {
    function accrue(address quote, uint256 amount) external;
}
