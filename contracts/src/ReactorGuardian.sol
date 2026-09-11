// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The only privileged security authority. Brake pedal, not steering wheel.
///         `guardian` is immutable (production: a Safe). Keeper is replaceable.
contract ReactorGuardian {
    address public immutable guardian;
    address public keeper;
    address public pricingSigner;

    bool public launchesPaused;
    bool public keeperPaused;
    bool public tradingPaused;

    mapping(address => bool) public adapterApproved;
    mapping(address => bool) public hookApproved;

    event KeeperReplaced(address indexed previous, address indexed next);
    event PricingSignerReplaced(address indexed previous, address indexed next);
    event LaunchesPause(bool paused);
    event KeeperPause(bool paused);
    event TradingPause(bool paused);
    event AdapterSet(address indexed adapter, bool approved);
    event HookSet(address indexed hook, bool approved);

    error NotGuardian();
    error ZeroAddress();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address guardian_, address keeper_) {
        if (guardian_ == address(0) || keeper_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        keeper = keeper_;
        pricingSigner = keeper_;
    }

    function setPricingSigner(address next) external onlyGuardian {
        if (next == address(0)) revert ZeroAddress();
        emit PricingSignerReplaced(pricingSigner, next);
        pricingSigner = next;
    }

    function setKeeper(address next) external onlyGuardian {
        if (next == address(0)) revert ZeroAddress();
        emit KeeperReplaced(keeper, next);
        keeper = next;
    }

    function pauseLaunches(bool paused) external onlyGuardian {
        launchesPaused = paused;
        emit LaunchesPause(paused);
    }

    function pauseKeeper(bool paused) external onlyGuardian {
        keeperPaused = paused;
        emit KeeperPause(paused);
    }

    function pauseTrading(bool paused) external onlyGuardian {
        tradingPaused = paused;
        emit TradingPause(paused);
    }

    function setAdapter(address adapter, bool approved) external onlyGuardian {
        if (adapter == address(0)) revert ZeroAddress();
        adapterApproved[adapter] = approved;
        emit AdapterSet(adapter, approved);
    }

    function setHook(address hook, bool approved) external onlyGuardian {
        hookApproved[hook] = approved;
        emit HookSet(hook, approved);
    }

    function requireKeeper(address caller) external view {
        if (keeperPaused) revert KeeperIsPaused();
        if (caller != keeper) revert NotKeeper();
    }

    function requireLaunchesOpen() external view {
        if (launchesPaused) revert LaunchesArePaused();
    }

    function requireTradingOpen() external view {
        if (tradingPaused) revert TradingIsPaused();
    }

    error NotKeeper();
    error KeeperIsPaused();
    error LaunchesArePaused();
    error TradingIsPaused();
}
