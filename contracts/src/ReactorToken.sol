// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorConstants} from "./ReactorConstants.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorToken} from "./interfaces/IReactorToken.sol";

/// @notice Fixed-supply ERC-20 with O(1) quote-side holder rewards. Zero transfer tax.
contract ReactorToken is IReactorToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public immutable totalSupply;
    address public immutable quoteAsset;
    address public immutable hook;
    address public immutable poolManager;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public rewardExcluded;

    uint256 public accRewardPerShare;
    uint256 public leftoverRewards;
    uint256 public excludedBalance;
    uint256 public lifetimeRewards;

    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public storedRewards;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event RewardClaimed(address indexed account, address indexed to, uint256 amount);
    event RewardsCredited(uint256 amount, uint256 accRewardPerShare);

    error NotHook();
    error ZeroAddress();
    error Insufficient();

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 supply,
        address quote,
        address hook_,
        address poolManager_,
        address liquidityVault,
        address buybackVault,
        address recipient,
        bool excludeRecipient
    ) {
        if (quote == address(0) || hook_ == address(0) || poolManager_ == address(0) || recipient == address(0)) {
            revert ZeroAddress();
        }
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        totalSupply = supply;
        quoteAsset = quote;
        hook = hook_;
        poolManager = poolManager_;

        _exclude(address(0));
        _exclude(ReactorConstants.DEAD);
        _exclude(poolManager_);
        _exclude(liquidityVault);
        _exclude(buybackVault);
        _exclude(address(this));
        if (excludeRecipient) _exclude(recipient);

        balanceOf[recipient] = supply;
        if (rewardExcluded[recipient]) excludedBalance += supply;
        emit Transfer(address(0), recipient, supply);
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
            if (allowed < amount) revert Insufficient();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function creditRewards(uint256 amount) external onlyHook {
        if (amount == 0) return;
        lifetimeRewards += amount;
        uint256 dist = amount + leftoverRewards;
        uint256 supply = eligibleSupply();
        if (supply == 0) {
            leftoverRewards = dist;
            emit RewardsCredited(amount, accRewardPerShare);
            return;
        }
        uint256 increment = (dist * ReactorConstants.REWARD_PRECISION) / supply;
        accRewardPerShare += increment;
        leftoverRewards = dist - (increment * supply) / ReactorConstants.REWARD_PRECISION;
        emit RewardsCredited(amount, accRewardPerShare);
    }

    function claimRewards(address to) external returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        _accrue(msg.sender);
        _syncDebt(msg.sender);
        uint256 amt = storedRewards[msg.sender];
        storedRewards[msg.sender] = 0;
        if (amt > 0) {
            bool ok = IERC20MinimalExt(quoteAsset).transfer(to, amt);
            require(ok, "XFER");
            emit RewardClaimed(msg.sender, to, amt);
        }
        return amt;
    }

    function pendingRewards(address account) public view returns (uint256) {
        return storedRewards[account] + _unpaid(account);
    }

    function eligibleSupply() public view returns (uint256) {
        uint256 excl = excludedBalance;
        return excl >= totalSupply ? 0 : totalSupply - excl;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (from != to) {
            _accrue(from);
            _accrue(to);
        } else {
            _accrue(from);
        }

        uint256 bal = balanceOf[from];
        if (bal < amount) revert Insufficient();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }

        if (rewardExcluded[from] && !rewardExcluded[to]) {
            excludedBalance -= amount;
        } else if (!rewardExcluded[from] && rewardExcluded[to]) {
            excludedBalance += amount;
        }

        if (from != to) {
            _syncDebt(from);
            _syncDebt(to);
        } else {
            _syncDebt(from);
        }
        _flushLeftover();
        emit Transfer(from, to, amount);
    }

    function _flushLeftover() internal {
        uint256 dist = leftoverRewards;
        uint256 supply = eligibleSupply();
        if (dist == 0 || supply == 0) return;
        uint256 increment = (dist * ReactorConstants.REWARD_PRECISION) / supply;
        accRewardPerShare += increment;
        leftoverRewards = dist - (increment * supply) / ReactorConstants.REWARD_PRECISION;
    }

    function _accrue(address account) internal {
        if (rewardExcluded[account]) return;
        uint256 unpaid = _unpaid(account);
        if (unpaid > 0) storedRewards[account] += unpaid;
    }

    function _syncDebt(address account) internal {
        if (rewardExcluded[account]) {
            rewardDebt[account] = 0;
            return;
        }
        rewardDebt[account] = (balanceOf[account] * accRewardPerShare) / ReactorConstants.REWARD_PRECISION;
    }

    function _unpaid(address account) internal view returns (uint256) {
        if (rewardExcluded[account]) return 0;
        uint256 accumulated = (balanceOf[account] * accRewardPerShare) / ReactorConstants.REWARD_PRECISION;
        uint256 debt = rewardDebt[account];
        return accumulated > debt ? accumulated - debt : 0;
    }

    function _exclude(address account) internal {
        rewardExcluded[account] = true;
    }
}
