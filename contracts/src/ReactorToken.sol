// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorConstants} from "./ReactorConstants.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorToken} from "./interfaces/IReactorToken.sol";

/// @notice Fixed-ish ERC-20 with O(1) magnified dividend-per-share quote rewards.
/// Dust stays in leftoverMagnified (modulo eligible supply) and is never allocated twice.
contract ReactorToken is IReactorToken {
    uint256 internal constant MAG = ReactorConstants.REWARD_MAGNITUDE;

    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public immutable quoteAsset;
    address public immutable hook;
    address public immutable poolManager;
    address public immutable factory;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public rewardExcluded;

    uint256 public magnifiedDividendPerShare;
    uint256 public leftoverMagnified;
    uint256 public excludedBalance;
    uint256 public lifetimeRewards;
    uint256 public lifetimeClaimed;

    mapping(address => int256) public magnifiedDividendCorrections;
    mapping(address => uint256) public storedRewards;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event RewardClaimed(address indexed account, address indexed to, uint256 amount);
    event RewardsCredited(uint256 amount, uint256 magnifiedDividendPerShare);
    event Burned(address indexed account, uint256 amount);
    event ProtocolExcluded(address indexed account);

    error NotHook();
    error NotAuth();
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
        address flywheelVault,
        address recipient,
        bool excludeRecipient,
        address factory_
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
        factory = factory_ == address(0) ? msg.sender : factory_;

        _exclude(address(0));
        _exclude(ReactorConstants.DEAD);
        _exclude(poolManager_);
        _exclude(liquidityVault);
        if (flywheelVault != address(0)) _exclude(flywheelVault);
        _exclude(address(this));
        if (excludeRecipient) _exclude(recipient);

        balanceOf[recipient] = supply;
        if (rewardExcluded[recipient]) excludedBalance += supply;
        emit Transfer(address(0), recipient, supply);
    }

    function excludeProtocol(address account) external {
        if (msg.sender != hook && msg.sender != factory) revert NotAuth();
        if (account == address(0) || rewardExcluded[account]) return;
        _accrue(account);
        _exclude(account);
        excludedBalance += balanceOf[account];
        magnifiedDividendCorrections[account] = 0;
        emit ProtocolExcluded(account);
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

    function burn(uint256 amount) external {
        _accrue(msg.sender);
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert Insufficient();
        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalSupply -= amount;
        }
        if (rewardExcluded[msg.sender]) excludedBalance -= amount;
        _syncCorrection(msg.sender);
        _flushLeftover();
        emit Transfer(msg.sender, address(0), amount);
        emit Burned(msg.sender, amount);
    }

    function creditRewards(uint256 amount) external {
        if (msg.sender != hook && msg.sender != factory) revert NotAuth();
        if (amount == 0) return;
        lifetimeRewards += amount;
        _distributeMagnified(amount * MAG);
        emit RewardsCredited(amount, magnifiedDividendPerShare);
    }

    function claimRewards(address to) external returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        _accrue(msg.sender);
        _syncCorrection(msg.sender);
        uint256 amt = storedRewards[msg.sender];
        storedRewards[msg.sender] = 0;
        if (amt > 0) {
            lifetimeClaimed += amt;
            bool ok = IERC20MinimalExt(quoteAsset).transfer(to, amt);
            require(ok, "XFER");
            emit RewardClaimed(msg.sender, to, amt);
        }
        return amt;
    }

    function pendingRewards(address account) public view returns (uint256) {
        return storedRewards[account] + _withdrawable(account);
    }

    function leftoverRewards() public view returns (uint256) {
        return leftoverMagnified / MAG;
    }

    function accRewardPerShare() external view returns (uint256) {
        return magnifiedDividendPerShare;
    }

    function rewardDebt(address) external pure returns (uint256) {
        return 0;
    }

    function eligibleSupply() public view returns (uint256) {
        uint256 excl = excludedBalance;
        return excl >= totalSupply ? 0 : totalSupply - excl;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        _accrue(from);
        if (from != to) _accrue(to);

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

        _syncCorrection(from);
        if (from != to) _syncCorrection(to);
        _flushLeftover();
        emit Transfer(from, to, amount);
    }

    function _distributeMagnified(uint256 magnifiedAmount) internal {
        uint256 dist = leftoverMagnified + magnifiedAmount;
        uint256 supply = eligibleSupply();
        if (supply == 0) {
            leftoverMagnified = dist;
            return;
        }
        magnifiedDividendPerShare += dist / supply;
        leftoverMagnified = dist % supply;
    }

    function _flushLeftover() internal {
        if (leftoverMagnified == 0) return;
        uint256 supply = eligibleSupply();
        if (supply == 0) return;
        magnifiedDividendPerShare += leftoverMagnified / supply;
        leftoverMagnified = leftoverMagnified % supply;
    }

    function _accrue(address account) internal {
        if (rewardExcluded[account]) return;
        uint256 unpaid = _withdrawable(account);
        if (unpaid > 0) storedRewards[account] += unpaid;
    }

    function _syncCorrection(address account) internal {
        if (rewardExcluded[account]) {
            magnifiedDividendCorrections[account] = 0;
            return;
        }
        magnifiedDividendCorrections[account] = -int256(magnifiedDividendPerShare * balanceOf[account]);
    }

    function _withdrawable(address account) internal view returns (uint256) {
        if (rewardExcluded[account]) return 0;
        int256 accumulated =
            int256(magnifiedDividendPerShare * balanceOf[account]) + magnifiedDividendCorrections[account];
        if (accumulated <= 0) return 0;
        return uint256(accumulated) / MAG;
    }

    function _exclude(address account) internal {
        rewardExcluded[account] = true;
    }
}
