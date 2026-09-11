// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "../ReactorGuardian.sol";
import {Ticker} from "./Ticker.sol";

/// @notice EIP-712 LaunchAuthorization — required for EVERY new launch, including USDC.
/// Binds creator + quote + factory + ticker + pricing fields. Unique authId. Digest-level
/// replay (no serial quote nonce). Signed by the isolated Launch Signer.
library LaunchAuthorization {
    bytes32 internal constant INSTANT_CURVE_V1 = keccak256("REACTOR.InstantCurve.v1");
    bytes32 internal constant FAIR_V1 = keccak256("REACTOR.FairLaunch.v1");
    uint256 internal constant MAX_TTL = 30 minutes;

    bytes32 internal constant TYPEHASH = keccak256(
        "LaunchAuthorization(address factory,address creator,address quote,uint8 quoteDecimals,uint256 virtualQuote0,bytes32 curveConfig,bytes32 tickerHash,bytes32 authId,uint256 deadline,uint256 chainId)"
    );

    struct Auth {
        address factory;
        address creator;
        address quote;
        uint8 quoteDecimals;
        uint256 virtualQuote0;
        bytes32 curveConfig;
        bytes32 tickerHash;
        bytes32 authId;
        uint256 deadline;
    }

    error Expired();
    error WrongChain();
    error WrongFactory();
    error WrongQuote();
    error WrongCreator();
    error WrongDecimals();
    error WrongTicker();
    error WrongParams();
    error BadSigner();
    error Replay();

    function digest(bytes32 domainSeparator, Auth memory a) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(
                    abi.encode(
                        TYPEHASH,
                        a.factory,
                        a.creator,
                        a.quote,
                        a.quoteDecimals,
                        a.virtualQuote0,
                        a.curveConfig,
                        a.tickerHash,
                        a.authId,
                        a.deadline,
                        block.chainid
                    )
                )
            )
        );
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
        address factory,
        address creator,
        address quote,
        uint8 quoteDecimals,
        bytes32 curveConfig,
        string memory canonicalTicker,
        Auth memory a,
        bytes memory sig
    ) internal view returns (bytes32 d) {
        if (block.timestamp > a.deadline) revert Expired();
        if (a.deadline > block.timestamp + MAX_TTL) revert Expired();
        if (a.factory != factory) revert WrongFactory();
        if (a.creator != creator) revert WrongCreator();
        if (a.quote != quote) revert WrongQuote();
        if (a.quoteDecimals != quoteDecimals) revert WrongDecimals();
        if (a.curveConfig != curveConfig) revert WrongParams();
        if (a.authId == bytes32(0)) revert WrongParams();
        if (a.tickerHash != Ticker.hashCanonical(canonicalTicker)) revert WrongTicker();
        d = digest(domainSeparator, a);
        address signer = recover(d, sig);
        if (signer != auth.launchSigner()) revert BadSigner();
    }
}
