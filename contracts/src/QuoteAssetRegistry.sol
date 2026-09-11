// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReactorGuardian} from "./ReactorGuardian.sol";

/// @notice External quotes are Guardian-curated. Graduated REACTOR tokens register as native quotes
///         without a per-token Guardian action. Guardian may quarantine any quote.
contract QuoteAssetRegistry {
    enum Category {
        Crypto,
        Stocks,
        Commodities,
        FX,
        Stablecoins,
        ArcEcosystem,
        ReactorNative
    }

    struct QuoteAsset {
        address token;
        string symbol;
        string name;
        uint8 decimals;
        string icon;
        Category category;
        bool enabled;
        bool exists;
        bool rewardsEnabled;
        bool buybackRouteEnabled;
        bool hopViaUsdc;
        bool reactorNative;
    }

    ReactorGuardian public immutable auth;
    address public usdc;
    address public factory;
    mapping(address => QuoteAsset) public assets;
    address[] public list;

    event QuoteRegistered(address indexed token, string symbol, Category category, bool reactorNative);
    event QuoteUpdated(address indexed token, bool enabled);
    event BuybackRouteSet(address indexed token, bool enabled, bool hopViaUsdc);
    event UsdcSet(address indexed usdc);
    event FactoryBound(address factory);

    error NotGuardian();
    error NotFactory();
    error AlreadyRegistered();
    error UnknownQuote();
    error BadUsdc();
    error AlreadyBound();

    modifier onlyGuardian() {
        if (msg.sender != auth.guardian()) revert NotGuardian();
        _;
    }

    constructor(ReactorGuardian auth_) {
        auth = auth_;
    }

    function bindFactory(address factory_) external onlyGuardian {
        if (factory != address(0)) revert AlreadyBound();
        if (factory_ == address(0)) revert NotFactory();
        factory = factory_;
        emit FactoryBound(factory_);
    }

    function setUsdc(address usdc_) external onlyGuardian {
        if (usdc_ == address(0)) revert BadUsdc();
        if (usdc != address(0) && usdc != usdc_) revert BadUsdc();
        usdc = usdc_;
        emit UsdcSet(usdc_);
    }

    /// @notice Guardian adds an EXTERNAL quote. Cannot invent a REACTOR-native quote here.
    function register(
        address token,
        string calldata symbol,
        string calldata name,
        uint8 decimals,
        string calldata icon,
        Category category
    ) external onlyGuardian {
        if (assets[token].exists) revert AlreadyRegistered();
        if (category == Category.ReactorNative) revert NotGuardian();
        assets[token] = QuoteAsset({
            token: token,
            symbol: symbol,
            name: name,
            decimals: decimals,
            icon: icon,
            category: category,
            enabled: true,
            exists: true,
            rewardsEnabled: true,
            buybackRouteEnabled: false,
            hopViaUsdc: false,
            reactorNative: false
        });
        list.push(token);
        emit QuoteRegistered(token, symbol, category, false);
    }

    /// @notice Factory-only. Graduated REACTOR tokens become quotes without Guardian.
    function registerNative(address token, string calldata symbol, string calldata name, uint8 decimals) external {
        if (msg.sender != factory) revert NotFactory();
        if (assets[token].exists) revert AlreadyRegistered();
        assets[token] = QuoteAsset({
            token: token,
            symbol: symbol,
            name: name,
            decimals: decimals,
            icon: "",
            category: Category.ReactorNative,
            enabled: true,
            exists: true,
            rewardsEnabled: true,
            buybackRouteEnabled: true,
            hopViaUsdc: true,
            reactorNative: true
        });
        list.push(token);
        emit QuoteRegistered(token, symbol, Category.ReactorNative, true);
    }

    function setEnabled(address token, bool enabled) external onlyGuardian {
        if (!assets[token].exists) revert UnknownQuote();
        assets[token].enabled = enabled;
        emit QuoteUpdated(token, enabled);
    }

    function setIcon(address token, string calldata icon) external onlyGuardian {
        if (!assets[token].exists) revert UnknownQuote();
        assets[token].icon = icon;
        emit QuoteUpdated(token, assets[token].enabled);
    }

    function setBuybackRoute(address token, bool enabled, bool hopViaUsdc_) external onlyGuardian {
        if (!assets[token].exists) revert UnknownQuote();
        if (assets[token].reactorNative) revert NotGuardian();
        assets[token].buybackRouteEnabled = enabled;
        assets[token].hopViaUsdc = hopViaUsdc_;
        emit BuybackRouteSet(token, enabled, hopViaUsdc_);
    }

    function isEnabled(address token) public view returns (bool) {
        return assets[token].exists && assets[token].enabled;
    }

    function canLaunch(address token) public view returns (bool) {
        QuoteAsset storage a = assets[token];
        if (!a.exists || !a.enabled || !a.rewardsEnabled) return false;
        if (a.reactorNative) return true;
        return a.buybackRouteEnabled;
    }

    function isReactorNative(address token) external view returns (bool) {
        return assets[token].reactorNative && assets[token].enabled;
    }

    function count() external view returns (uint256) {
        return list.length;
    }

    function get(address token) external view returns (QuoteAsset memory) {
        return assets[token];
    }
}
