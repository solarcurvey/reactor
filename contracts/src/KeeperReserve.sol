// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorConstants} from "./ReactorConstants.sol";

/// @notice Isolated USDC bounty pot. Cannot pull holder or fee vault balances.
contract KeeperReserve {
    address public immutable usdc;
    address public immutable owner;
    mapping(address => bool) public callerOk;
    mapping(bytes32 => bool) public paid;
    mapping(uint64 => uint256) public paidInEpoch;
    uint256 public lifetimePaid;

    event Funded(uint256 amount);
    event BountyPaid(bytes32 indexed op, address indexed keeper, uint256 amount);

    error NotOwner();
    error NotCaller();

    constructor(address usdc_, address owner_) {
        usdc = usdc_;
        owner = owner_;
    }

    function setCaller(address c, bool ok) external {
        if (msg.sender != owner) revert NotOwner();
        callerOk[c] = ok;
    }

    function fund(uint256 amount) external {
        IERC20MinimalExt(usdc).transferFrom(msg.sender, address(this), amount);
        emit Funded(amount);
    }

    function tryPay(bytes32 op, address keeper, uint64 epoch) external {
        if (!callerOk[msg.sender]) revert NotCaller();
        if (paid[op] || keeper == address(0)) return;
        if (paidInEpoch[epoch] >= ReactorConstants.KEEPER_MAX_PER_EPOCH) return;
        uint256 bounty = ReactorConstants.KEEPER_BOUNTY_USDC;
        if (IERC20MinimalExt(usdc).balanceOf(address(this)) < bounty) return;
        paid[op] = true;
        paidInEpoch[epoch] += 1;
        lifetimePaid += bounty;
        IERC20MinimalExt(usdc).transfer(keeper, bounty);
        emit BountyPaid(op, keeper, bounty);
    }
}
