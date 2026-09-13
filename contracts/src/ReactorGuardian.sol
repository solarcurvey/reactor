// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ITickerAdmin} from "./interfaces/ITickerAdmin.sol";
import {ITickerGenesis, IVestingGenesis} from "./interfaces/IGenesisTargets.sol";
import {GenesisComplete} from "./libraries/GenesisComplete.sol";
import {GenesisTypes} from "./libraries/GenesisTypes.sol";

/// @notice The only privileged security authority. Brake pedal, not steering wheel.
///         `guardian` is immutable (production: a Safe, or an EOA where Safe is unavailable).
///         Keeper is replaceable. Launch Signer ≠ Keeper ≠ Guardian. Guardian rotates the signer.
///
///         EOA genesis: `completeGenesis` is onlyGuardian, one-shot, and keeps launches paused unless
///         `unpauseAfterVerify` is set after internal checks equivalent to VerifyGenesis.
///         `isGuardian(address(this))` is true only while the transient genesis proxy is on.
///         After seal, peripherals accept the immutable guardian EOA/Safe again — not this contract.
///         Safe MultiSend (`SafeGenesisBatch`) still works: the Safe *is* `guardian()`.
contract ReactorGuardian {
    address public immutable guardian;
    address public keeper;
    address public pricingSigner;
    address internal _launchSigner;
    ITickerAdmin public tickers;

    bool public launchesPaused;
    bool public keeperPaused;
    bool public tradingPaused;
    bool public genesisSealed;
    bool public genesisFinalized;
    bool internal _genesisProxyActive;

    mapping(address => bool) public adapterApproved;

    event KeeperReplaced(address indexed previous, address indexed next);
    event PricingSignerReplaced(address indexed previous, address indexed next);
    event LaunchSignerReplaced(address indexed previous, address indexed next);
    event TickerRegistryBound(address indexed tickers);
    event LaunchesPause(bool paused);
    event KeeperPause(bool paused);
    event TradingPause(bool paused);
    event AdapterSet(address indexed adapter, bool approved);
    event GenesisCompleted(bool unpaused);
    event GenesisFinalized();

    error NotGuardian();
    error ZeroAddress();
    error AlreadyBound();
    error GenesisAlreadySealed();
    error GenesisNotComplete();
    error GenesisAlreadyFinalized();
    error LaunchesMustStayPaused();
    error KeyReuse();
    error BadWiring();
    error ReentrantGenesis();

    /// @notice Immutable EOA/Safe always. `address(this)` only during `completeGenesis` / `finalizeGenesis`.
    function isGuardian(address account) public view returns (bool) {
        if (account == guardian) return true;
        return account == address(this) && _genesisProxyActive;
    }

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

    /// @notice EOA/Safe one-shot Batch A. Seals the auth-contract proxy. Stays paused unless
    ///         `unpauseAfterVerify` (internal checks match VerifyGenesis / `GenesisComplete.verify`).
    function completeGenesis(GenesisTypes.Wiring calldata w, bool unpauseAfterVerify) external onlyGuardian {
        if (genesisSealed) revert GenesisAlreadySealed();
        if (!launchesPaused) revert LaunchesMustStayPaused();
        if (_genesisProxyActive) revert ReentrantGenesis();
        _assertGenesisKeys(w);

        _genesisProxyActive = true;
        _applyGuardianConfig(w);
        ITickerGenesis(w.tickers).authorizeFactory(w.factory, 1);
        GenesisComplete.wire(w);
        GenesisComplete.verify(w, this);
        _genesisProxyActive = false;
        genesisSealed = true;

        if (unpauseAfterVerify) {
            _finalize(w.vesting);
        }
        emit GenesisCompleted(unpauseAfterVerify);
    }

    /// @notice Tiny Batch B after a verify gap. EOA only. One-shot T0 + unpause.
    function finalizeGenesis(address vesting_) external onlyGuardian {
        if (!genesisSealed) revert GenesisNotComplete();
        if (!launchesPaused) revert LaunchesMustStayPaused();
        _finalize(vesting_);
        emit GenesisCompleted(true);
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

    function _assertGenesisKeys(GenesisTypes.Wiring calldata w) internal view {
        if (w.pricingSigner == address(0) || w.launchSigner == address(0)) revert ZeroAddress();
        if (w.tickers == address(0) || w.factory == address(0) || w.registry == address(0)) revert ZeroAddress();
        if (w.usdc == address(0) || w.hook == address(0) || w.coreLp == address(0)) revert ZeroAddress();
        if (w.userAdapter == address(0) || w.protocolAdapter == address(0)) revert ZeroAddress();
        if (w.buyback == address(0) || w.flywheel == address(0) || w.launchModule == address(0)) revert ZeroAddress();
        if (w.vault == address(0) || w.curve == address(0) || w.selfBurn == address(0)) revert ZeroAddress();
        if (w.coreBuyback == address(0) || w.router == address(0) || w.userRouter == address(0)) revert ZeroAddress();
        if (w.vesting == address(0) || w.core == address(0)) revert ZeroAddress();
        if (w.pricingSigner == keeper || w.pricingSigner == guardian) revert KeyReuse();
        if (w.launchSigner == keeper || w.launchSigner == guardian) revert KeyReuse();
        if (w.deployer != address(0)) {
            if (w.deployer == guardian || w.deployer == keeper) revert KeyReuse();
            if (w.pricingSigner == w.deployer || w.launchSigner == w.deployer) revert KeyReuse();
        }
    }

    function _applyGuardianConfig(GenesisTypes.Wiring calldata w) internal {
        if (address(tickers) != address(0)) revert AlreadyBound();
        tickers = ITickerAdmin(w.tickers);
        emit TickerRegistryBound(w.tickers);
        emit PricingSignerReplaced(pricingSigner, w.pricingSigner);
        pricingSigner = w.pricingSigner;
        emit LaunchSignerReplaced(_launchSigner, w.launchSigner);
        _launchSigner = w.launchSigner;
        adapterApproved[w.userAdapter] = true;
        adapterApproved[w.protocolAdapter] = true;
        emit AdapterSet(w.userAdapter, true);
        emit AdapterSet(w.protocolAdapter, true);
    }

    function _finalize(address vesting_) internal {
        if (genesisFinalized) revert GenesisAlreadyFinalized();
        if (IVestingGenesis(vesting_).auth() != address(this)) revert BadWiring();
        genesisFinalized = true;
        _genesisProxyActive = true;
        IVestingGenesis(vesting_).activateLaunch();
        _genesisProxyActive = false;
        launchesPaused = false;
        emit LaunchesPause(false);
        emit GenesisFinalized();
    }

    error NotKeeper();
    error KeeperIsPaused();
    error LaunchesArePaused();
    error TradingIsPaused();
}
