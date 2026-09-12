// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ITickerAdmin} from "./interfaces/ITickerAdmin.sol";

/// @notice The only privileged security authority. Brake pedal, not steering wheel.
///         `guardian` is immutable (production: a Safe). Keeper is replaceable.
///         Launch Signer ≠ Keeper ≠ Guardian Safe. Guardian rotates the signer.
contract ReactorGuardian {
    address public immutable guardian;
    address public keeper;
    address public pricingSigner;
    address internal _launchSigner;
    ITickerAdmin public tickers;

    bool public launchesPaused;
    bool public keeperPaused;
    bool public tradingPaused;

    mapping(address => bool) public adapterApproved;

    event KeeperReplaced(address indexed previous, address indexed next);
    event PricingSignerReplaced(address indexed previous, address indexed next);
    event LaunchSignerReplaced(address indexed previous, address indexed next);
    event TickerRegistryBound(address indexed tickers);
    event LaunchesPause(bool paused);
    event KeeperPause(bool paused);
    event TradingPause(bool paused);
    event AdapterSet(address indexed adapter, bool approved);

    error NotGuardian();
    error ZeroAddress();
    error AlreadyBound();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address guardian_, address keeper_) {
        if (guardian_ == address(0) || keeper_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        keeper = keeper_;
        pricingSigner = keeper_;
        launchesPaused = true;
    }

    /// @notice Isolated launch signer. Falls back to pricingSigner until explicitly set.
    function launchSigner() public view returns (address) {
        return _launchSigner == address(0) ? pricingSigner : _launchSigner;
    }

    function setPricingSigner(address next) external onlyGuardian {
        if (next == address(0)) revert ZeroAddress();
        emit PricingSignerReplaced(pricingSigner, next);
        pricingSigner = next;
    }

    function setLaunchSigner(address next) external onlyGuardian {
        if (next == address(0)) revert ZeroAddress();
        emit LaunchSignerReplaced(_launchSigner, next);
        _launchSigner = next;
    }

    function bindTickerRegistry(address tickers_) external onlyGuardian {
        if (address(tickers) != address(0)) revert AlreadyBound();
        if (tickers_ == address(0)) revert ZeroAddress();
        tickers = ITickerAdmin(tickers_);
        emit TickerRegistryBound(tickers_);
    }

    function permanentlyLockTicker(string calldata ticker, address canonicalToken) external onlyGuardian {
        tickers.permanentlyLockTicker(ticker, canonicalToken);
    }

    function reserveTicker(string calldata ticker) external onlyGuardian {
        tickers.reserveTicker(ticker);
    }

    function authorizeFactory(address factory, uint32 version) external onlyGuardian {
        tickers.authorizeFactory(factory, version);
    }

    function deprecateFactory(address factory) external onlyGuardian {
        tickers.deprecateFactory(factory);
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
