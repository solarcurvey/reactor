// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Curated quote allowlist. Admin cannot custody funds or change protocol fees.
contract QuoteAssetRegistry {
    enum Category {
        Crypto,
        Stocks,
        Commodities,
        FX,
        Stablecoins,
        ArcEcosystem
    }

    struct QuoteAsset {
        address token;
        string symbol;
        string name;
        uint8 decimals;
        string icon;
        Category category;
        address usdOracle;
        bool enabled;
        bool exists;
    }

    address public admin;
    mapping(address => QuoteAsset) public assets;
    address[] public list;

    event AdminTransferred(address indexed previous, address indexed next);
    event QuoteRegistered(address indexed token, string symbol, Category category);
    event QuoteUpdated(address indexed token, bool enabled);

    error NotAdmin();
    error AlreadyRegistered();
    error UnknownQuote();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        admin = admin_ == address(0) ? msg.sender : admin_;
    }

    function transferAdmin(address next) external onlyAdmin {
        emit AdminTransferred(admin, next);
        admin = next;
    }

    function register(
        address token,
        string calldata symbol,
        string calldata name,
        uint8 decimals,
        string calldata icon,
        Category category,
        address usdOracle
    ) external onlyAdmin {
        if (assets[token].exists) revert AlreadyRegistered();
        assets[token] = QuoteAsset({
            token: token,
            symbol: symbol,
            name: name,
            decimals: decimals,
            icon: icon,
            category: category,
            usdOracle: usdOracle,
            enabled: true,
            exists: true
        });
        list.push(token);
        emit QuoteRegistered(token, symbol, category);
    }

    function setEnabled(address token, bool enabled) external onlyAdmin {
        if (!assets[token].exists) revert UnknownQuote();
        assets[token].enabled = enabled;
        emit QuoteUpdated(token, enabled);
    }

    function setMeta(address token, string calldata icon, address usdOracle) external onlyAdmin {
        if (!assets[token].exists) revert UnknownQuote();
        assets[token].icon = icon;
        assets[token].usdOracle = usdOracle;
        emit QuoteUpdated(token, assets[token].enabled);
    }

    function isEnabled(address token) public view returns (bool) {
        return assets[token].exists && assets[token].enabled;
    }

    function count() external view returns (uint256) {
        return list.length;
    }

    function get(address token) external view returns (QuoteAsset memory) {
        return assets[token];
    }
}