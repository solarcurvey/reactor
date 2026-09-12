// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library LaunchTypes {
    struct InstantParams {
        string name;
        string symbol;
        uint8 decimals;
        uint256 supply;
        address quote;
        uint256 fdvQuoteRaw;
        uint256 devBuyQuote;
        string image;
        string description;
        string website;
        string twitter;
        string telegram;
    }

    struct FairParams {
        string name;
        string symbol;
        uint8 decimals;
        uint256 supply;
        address quote;
        uint64 duration;
        uint16 auctionBps;
        uint256 minRaise;
        string image;
        string description;
        string website;
        string twitter;
        string telegram;
    }
}
