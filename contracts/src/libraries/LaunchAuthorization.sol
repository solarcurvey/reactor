// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "../ReactorGuardian.sol";
import {Ticker} from "./Ticker.sol";

/// @notice EIP-712 LaunchAuthorization — required for EVERY new launch, including USDC.
/// Binds the full immutable launch identity. Unique authId. Digest-level replay
/// (no serial quote nonce). Signed by the isolated Launch Signer after admission.
library LaunchAuthorization {
    bytes32 internal constant INSTANT_CURVE_V1 = keccak256("REACTOR.InstantCurve.v1");
    /// @dev Identifier only. Fair LaunchAuthorization binds `fairCurveConfig(...)`, not this constant.
    bytes32 internal constant FAIR_V1 = keccak256("REACTOR.FairLaunch.v1");
    uint256 internal constant MAX_TTL = 30 minutes;

    /// @notice Fair `curveConfig` digest. Instant keeps `INSTANT_CURVE_V1`.
    function fairCurveConfig(uint256 supply, uint8 decimals, uint64 duration, uint16 auctionBps, uint256 minRaise)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(supply, decimals, duration, auctionBps, minRaise));
    }

    uint8 internal constant MODE_STANDARD = 0;
    uint8 internal constant MODE_REWARDS = 1;
    uint8 internal constant MODE_FAIR = 2;

    /// @dev EIP-712 typehash. Strings are hashed as keccak256(bytes(...)) in the struct hash.
    bytes32 internal constant TYPEHASH = keccak256(
        "LaunchAuthorization(address factory,uint32 factoryVersion,address creator,address quote,uint8 quoteDecimals,uint8 mode,string ticker,string name,bytes32 metadataHash,uint256 virtualQuote0,bytes32 curveConfig,bytes32 authId,uint256 deadline,uint256 chainId)"
    );

    struct Auth {
        address factory;
        uint32 factoryVersion;
        address creator;
        address quote;
        uint8 quoteDecimals;
        uint8 mode;
        string ticker;
        string name;
        bytes32 metadataHash;
        uint256 virtualQuote0;
        bytes32 curveConfig;
        bytes32 authId;
        uint256 deadline;
    }

    struct Expected {
        address factory;
        uint32 factoryVersion;
        address creator;
        address quote;
        uint8 quoteDecimals;
        uint8 mode;
        bytes32 curveConfig;
        string ticker;
        string name;
        bytes32 metadataHash;
    }

    error Expired();
    error WrongChain();
    error WrongFactory();
    error WrongQuote();
    error WrongCreator();
    error WrongDecimals();
    error WrongTicker();
    error WrongParams();
    error WrongName();
    error WrongMetadata();
    error WrongMode();
    error WrongVersion();
    error BadSigner();
    error Replay();

    function hashMetadata(
        string memory image,
        string memory description,
        string memory website,
        string memory twitter,
        string memory telegram
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(bytes(image)),
                keccak256(bytes(description)),
                keccak256(bytes(website)),
                keccak256(bytes(twitter)),
                keccak256(bytes(telegram))
            )
        );
    }

    /// @dev All encoded fields are static. Concat of two `abi.encode` groups equals one `abi.encode`.
    function _structHash(Auth memory a) internal view returns (bytes32) {
        bytes32 tickerH = keccak256(bytes(a.ticker));
        bytes32 nameH = keccak256(bytes(a.name));
        bytes memory head = abi.encode(TYPEHASH, a.factory, a.factoryVersion, a.creator, a.quote, a.quoteDecimals, a.mode);
        bytes memory tail = abi.encode(
            tickerH, nameH, a.metadataHash, a.virtualQuote0, a.curveConfig, a.authId, a.deadline, block.chainid
        );
        return keccak256(bytes.concat(head, tail));
    }

    function digest(bytes32 domainSeparator, Auth memory a) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, _structHash(a)));
    }

    function recover(bytes32 digest_, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSigner();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        address signer = ecrecover(digest_, v, r, s);
        if (signer == address(0)) revert BadSigner();
        return signer;
    }

    function verify(
        ReactorGuardian auth,
        bytes32 domainSeparator,
        Expected memory e,
        Auth memory a,
        bytes memory sig
    ) internal view returns (bytes32 d) {
        if (block.timestamp > a.deadline) revert Expired();
        if (a.deadline > block.timestamp + MAX_TTL) revert Expired();
        if (a.factory != e.factory) revert WrongFactory();
        if (a.factoryVersion != e.factoryVersion) revert WrongVersion();
        if (a.creator != e.creator) revert WrongCreator();
        if (a.quote != e.quote) revert WrongQuote();
        if (a.quoteDecimals != e.quoteDecimals) revert WrongDecimals();
        if (a.mode != e.mode) revert WrongMode();
        if (a.curveConfig != e.curveConfig) revert WrongParams();
        if (a.authId == bytes32(0)) revert WrongParams();
        if (Ticker.hashCanonical(a.ticker) != Ticker.hashCanonical(e.ticker)) revert WrongTicker();
        if (keccak256(bytes(a.name)) != keccak256(bytes(e.name))) revert WrongName();
        if (a.metadataHash != e.metadataHash) revert WrongMetadata();
        d = digest(domainSeparator, a);
        address signer = recover(d, sig);
        if (signer != auth.launchSigner()) revert BadSigner();
    }
}
