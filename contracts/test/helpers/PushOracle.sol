// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {MarketOracle} from "../../src/MarketOracle.sol";
import {ReactorHook} from "../../src/ReactorHook.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";

/// @notice Test-only TWAP inject. Production `MarketOracle` has no public seed.
contract PushOracle is MarketOracle {
    mapping(address => uint256) public forcedMcap;
    mapping(address => bool) public forced;

    constructor(IPoolManager pm, ReactorHook hook_, QuoteAssetRegistry registry_, address usdc_, address core_)
        MarketOracle(pm, hook_, registry_, usdc_, core_)
    {}

    function push(address token, uint256 mcapUsdc6) external {
        forcedMcap[token] = mcapUsdc6;
        forced[token] = true;
    }

    function clear(address token) external {
        delete forced[token];
        delete forcedMcap[token];
    }

    function twapMcapUsdc(address token) public view override returns (uint256 mcapUsdc6, bool ok) {
        if (forced[token]) return (forcedMcap[token], true);
        return super.twapMcapUsdc(token);
    }
}

/// @notice Minimal factory surface so FlywheelVault can rank without 11 full launches.
contract TokenListMock {
    address[] public allTokens;

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function add(address token) external {
        allTokens.push(token);
    }
}
