// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "../ReactorGuardian.sol";

/// @notice Short-lived EIP-712 authorization for non-$1 quote curve init. No onchain USD oracle.
library LaunchPricing {
    bytes32 internal constant TYPEHASH = keccak256(
        "LaunchPricingAuthorization(address factory,address quote,uint8 quoteDecimals,uint256 virtualQuote0,uint256 nonce,uint256 deadline,uint256 chainId)"
    );

    struct Auth {
        address factory;
        address quote;
        uint8 quoteDecimals;
        uint256 virtualQuote0;
        uint256 nonce;
        uint256 deadline;
    }

    error Expired();
    error WrongChain();
    error WrongFactory();
    error WrongQuote();
    error WrongDecimals();
    error WrongParams();
    error BadSigner();
    error Replay();
    error Quarantined();

    function digest(bytes32 domainSeparator, Auth memory a) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(
                    abi.encode(
                        TYPEHASH,
                        a.factory,
                        a.quote,
                        a.quoteDecimals,
                        a.virtualQuote0,
                        a.nonce,
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
        address quote,
        uint8 quoteDecimals,
        Auth memory a,
        bytes memory sig,
        mapping(bytes32 => bool) storage used
    ) internal {
        if (block.timestamp > a.deadline) revert Expired();
        if (a.factory != factory) revert WrongFactory();
        if (a.quote != quote) revert WrongQuote();
        if (a.quoteDecimals != quoteDecimals) revert WrongDecimals();
        if (a.virtualQuote0 == 0) revert WrongParams();
        bytes32 d = digest(domainSeparator, a);
        if (used[d]) revert Replay();
        address signer = recover(d, sig);
        if (signer != auth.pricingSigner()) revert BadSigner();
        used[d] = true;
    }
}
