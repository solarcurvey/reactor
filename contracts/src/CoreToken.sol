// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorConstants} from "./ReactorConstants.sol";

/// @notice REACTOR CORE — platform token. Mint once at genesis (100M vesting + 900M LP). No further mint.
/// Tokenomics unchanged from the previous TestCORE name. Symbol CORE.
contract CoreToken {
    string public constant name = "REACTOR CORE";
    string public constant symbol = "CORE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    bool public minted;
    address public immutable genesisAuthority;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Genesis(address indexed vesting, address indexed lpVault, uint256 vestingAmt, uint256 lpAmt);

    error NotGenesis();
    error AlreadyMinted();
    error Bad();

    constructor(address genesisAuthority_) {
        if (genesisAuthority_ == address(0)) revert Bad();
        genesisAuthority = genesisAuthority_;
    }

    /// @notice Atomic 10/90 mint. Authority cannot mint again. Deployer balance stays 0.
    function genesis(address vesting, address lpVault) external {
        if (msg.sender != genesisAuthority) revert NotGenesis();
        if (minted) revert AlreadyMinted();
        if (vesting == address(0) || lpVault == address(0) || vesting == lpVault) revert Bad();
        minted = true;
        _mint(vesting, ReactorConstants.CORE_VESTING_AMOUNT);
        _mint(lpVault, ReactorConstants.CORE_LP_AMOUNT);
        emit Genesis(vesting, lpVault, ReactorConstants.CORE_VESTING_AMOUNT, ReactorConstants.CORE_LP_AMOUNT);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ALLOWANCE");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Real burn. Reduces totalSupply. No dead-address fallback.
    function burn(uint256 amount) external {
        uint256 bal = balanceOf[msg.sender];
        require(bal >= amount, "BAL");
        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalSupply -= amount;
        }
        emit Transfer(msg.sender, address(0), amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "ZERO");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "BAL");
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
