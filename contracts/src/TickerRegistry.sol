// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "./ReactorGuardian.sol";
import {ITickerAdmin} from "./interfaces/ITickerAdmin.sol";
import {Ticker} from "./libraries/Ticker.sol";

interface IERC20Symbol {
    function symbol() external view returns (string memory);
}

/// @notice Global launch identity. Survives Factory V1/V2/…. Not owned by one factory.
/// Successful launch → 24h global ticker lock. Failed/expired auth does not squat.
/// Permanent lock is Guardian judgment only — never an mcap oracle.
contract TickerRegistry is ITickerAdmin {
    using Ticker for string;

    uint32 public constant VERSION = 1;
    uint256 public constant MAX_TICKER_LEN = Ticker.MAX_LEN;
    uint64 public constant LOCK_SECONDS = Ticker.LOCK_SECONDS;

    ReactorGuardian public immutable auth;
    bytes32 public immutable domainSeparator;

    struct Record {
        address token;
        address factory;
        uint64 lockedUntil;
        bool permanent;
        uint32 factoryVersion;
    }

    struct FactoryInfo {
        uint32 version;
        bool authorized;
        bool deprecated;
    }

    mapping(bytes32 => Record) public records;
    mapping(bytes32 => bool) public usedAuthorization;
    mapping(address => FactoryInfo) public factories;
    mapping(address => uint32) public tokenFactoryVersion;
    mapping(address => bytes32) public tokenTickerKey;

    event FactoryAuthorized(address indexed factory, uint32 version);
    event FactoryDeprecated(address indexed factory, uint32 version);
    event TickerClaimed(
        string ticker, address indexed token, address indexed factory, uint32 version, uint64 lockedUntil
    );
    event TickerPermanentlyLocked(string ticker, address indexed canonicalToken);
    event AuthorizationConsumed(bytes32 indexed digest);

    error NotGuardian();
    error ZeroAddress();
    error AlreadySet();
    error FactoryInactive();
    error TickerUnavailable();
    error TickerPermanent();
    error Replay();
    error BadVersion();
    error NotReactorNative();
    error TickerMismatch();
    error ReservedSeparate();

    modifier onlyGuardian() {
        if (msg.sender != auth.guardian() && msg.sender != address(auth)) revert NotGuardian();
        _;
    }

    constructor(ReactorGuardian auth_) {
        if (address(auth_) == address(0)) revert ZeroAddress();
        auth = auth_;
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("REACTOR"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
        _reserve("CORE");
        _reserve("REACTOR");
        _reserve("USDC");
        _reserve("ZEC");
        _reserve("WBTC");
        _reserve("EURC");
    }

    function normalize(string calldata raw) external pure returns (string memory) {
        return Ticker.normalize(raw);
    }

    function tickerKey(string calldata raw) external pure returns (bytes32) {
        return Ticker.key(raw);
    }

    function isActiveFactory(address factory) public view returns (bool) {
        FactoryInfo storage f = factories[factory];
        return f.authorized && !f.deprecated && f.version != 0;
    }

    function factoryVersionOf(address factory) external view returns (uint32) {
        return factories[factory].version;
    }

    function authorizeFactory(address factory, uint32 version) external onlyGuardian {
        if (factory == address(0) || version == 0) revert BadVersion();
        FactoryInfo storage f = factories[factory];
        if (f.authorized && f.version != version) revert AlreadySet();
        f.version = version;
        f.authorized = true;
        f.deprecated = false;
        emit FactoryAuthorized(factory, version);
    }

    /// @notice Stops NEW launches on this factory. Existing tokens are untouched forever.
    function deprecateFactory(address factory) external onlyGuardian {
        FactoryInfo storage f = factories[factory];
        if (!f.authorized) revert FactoryInactive();
        f.deprecated = true;
        emit FactoryDeprecated(factory, f.version);
    }

    function status(string calldata raw)
        external
        view
        returns (string memory canonical, Record memory rec, bool isAvailable, bool reserved)
    {
        canonical = Ticker.normalize(raw);
        rec = records[Ticker.hashCanonical(canonical)];
        reserved = rec.permanent && rec.token == address(0);
        isAvailable = _free(rec);
    }

    function available(string calldata raw) external view returns (bool) {
        return _free(records[Ticker.key(raw)]);
    }

    /// @notice Protocol-reserved name (CORE, USDC, …). Separate from locking a launched token.
    /// token == address(0) + permanent. Irreversible.
    function reserveTicker(string calldata raw) external onlyGuardian {
        string memory canonical = Ticker.normalize(raw);
        bytes32 k = Ticker.hashCanonical(canonical);
        Record storage rec = records[k];
        if (rec.permanent) revert TickerPermanent();
        if (rec.token != address(0) && rec.lockedUntil > block.timestamp) revert TickerUnavailable();
        rec.token = address(0);
        rec.factory = address(0);
        rec.lockedUntil = type(uint64).max;
        rec.permanent = true;
        rec.factoryVersion = 0;
        emit TickerPermanentlyLocked(canonical, address(0));
    }

    /// @notice One-way lock of a REACTOR-native token from an authorized factory with matching ticker.
    /// Reserved names use `reserveTicker`. Not an oracle. Irreversible.
    function permanentlyLockTicker(string calldata raw, address canonicalToken) external onlyGuardian {
        if (canonicalToken == address(0)) revert ReservedSeparate();
        string memory canonical = Ticker.normalize(raw);
        bytes32 k = Ticker.hashCanonical(canonical);
        Record storage rec = records[k];
        if (rec.permanent) revert TickerPermanent();
        if (tokenFactoryVersion[canonicalToken] == 0) revert NotReactorNative();
        if (tokenTickerKey[canonicalToken] != k) revert TickerMismatch();
        string memory onchain = Ticker.normalize(IERC20Symbol(canonicalToken).symbol());
        if (Ticker.hashCanonical(onchain) != k) revert TickerMismatch();
        rec.permanent = true;
        rec.lockedUntil = type(uint64).max;
        rec.token = canonicalToken;
        emit TickerPermanentlyLocked(canonical, canonicalToken);
    }

    /// @notice Called by an active factory on a successful launch. Reverts the whole create if taken.
    /// Failed / expired signatures never reach here, so they cannot squat.
    function claimOnLaunch(string calldata raw, address token, bytes32 authDigest)
        external
        returns (string memory canonical)
    {
        if (!isActiveFactory(msg.sender)) revert FactoryInactive();
        if (token == address(0) || authDigest == bytes32(0)) revert ZeroAddress();
        if (usedAuthorization[authDigest]) revert Replay();
        canonical = Ticker.normalize(raw);
        bytes32 k = Ticker.hashCanonical(canonical);
        Record storage rec = records[k];
        if (!_free(rec)) revert TickerUnavailable();
        usedAuthorization[authDigest] = true;
        uint32 ver = factories[msg.sender].version;
        rec.token = token;
        rec.factory = msg.sender;
        rec.lockedUntil = uint64(block.timestamp + LOCK_SECONDS);
        rec.factoryVersion = ver;
        tokenFactoryVersion[token] = ver;
        tokenTickerKey[token] = k;
        emit AuthorizationConsumed(authDigest);
        emit TickerClaimed(canonical, token, msg.sender, ver, rec.lockedUntil);
    }

    function _free(Record memory rec) internal view returns (bool) {
        if (rec.permanent) return false;
        if (rec.lockedUntil == 0) return true;
        return block.timestamp >= rec.lockedUntil;
    }

    function _reserve(string memory canonical) internal {
        bytes32 k = Ticker.hashCanonical(canonical);
        records[k] = Record({
            token: address(0), factory: address(0), lockedUntil: type(uint64).max, permanent: true, factoryVersion: 0
        });
        emit TickerPermanentlyLocked(canonical, address(0));
    }
}
