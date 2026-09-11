// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {ReactorHook} from "./ReactorHook.sol";
import {ReactorToken} from "./ReactorToken.sol";
import {QuoteAssetRegistry} from "./QuoteAssetRegistry.sol";
import {QuoteMath} from "./libraries/QuoteMath.sol";
import {ReactorConstants} from "./ReactorConstants.sol";

/// @notice RETIRED. V1 Top-10 ranks are offchain (REACTOR API). Do not wire this contract.
contract MarketOracle {
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    ReactorHook public immutable hook;
    QuoteAssetRegistry public immutable registry;
    address public immutable usdc;
    address public immutable core;

    struct Sample {
        uint64 ts;
        uint256 priceUsdc1e6;
    }

    mapping(address => Sample[8]) public ring;
    mapping(address => uint8) public nextIdx;
    mapping(address => uint64) public lastRecordAt;

    error CoreIneligible();
    error NoMarket();

    constructor(IPoolManager pm, ReactorHook hook_, QuoteAssetRegistry registry_, address usdc_, address core_) {
        poolManager = pm;
        hook = hook_;
        registry = registry_;
        usdc = usdc_;
        core = core_;
    }

    function record(address token) external {
        if (token == core) revert CoreIneligible();
        (address t, address quote, bool exists) = _market(token);
        if (!exists || t != token) revert NoMarket();
        if (lastRecordAt[token] != 0 && block.timestamp < lastRecordAt[token] + 30) return;
        uint256 px = _spotUsdc1e6(token, quote);
        if (px == 0) return;
        uint8 i = nextIdx[token];
        ring[token][i] = Sample({ts: uint64(block.timestamp), priceUsdc1e6: px});
        nextIdx[token] = uint8((i + 1) % 8);
        lastRecordAt[token] = uint64(block.timestamp);
    }

    /// @return mcapUsdc6 TWAP mcap in USDC-6 units; ok false if unsafe / no oracle path.
    /// @dev Virtual so tests can inject TWAP without a production seed/inject function.
    function twapMcapUsdc(address token) public view virtual returns (uint256 mcapUsdc6, bool ok) {
        if (token == core) return (0, false);
        (address t, address quote, bool exists) = _market(token);
        if (!exists || t != token) return (0, false);
        QuoteAssetRegistry.QuoteAsset memory qa = registry.get(quote);
        if (quote != usdc && qa.usdOracle == address(0) && !qa.hopViaUsdc && !qa.buybackRouteEnabled) {
            return (0, false);
        }
        uint256 sum;
        uint256 n;
        uint64 cutoff = block.timestamp <= ReactorConstants.EPOCH_LENGTH
            ? 0
            : uint64(block.timestamp - ReactorConstants.EPOCH_LENGTH);
        for (uint256 i; i < 8; i++) {
            Sample memory s = ring[token][i];
            if (s.ts >= cutoff && s.priceUsdc1e6 > 0) {
                sum += s.priceUsdc1e6;
                n++;
            }
        }
        if (n < 2) return (0, false);
        uint256 px = sum / n;
        uint256 supply = ReactorToken(token).totalSupply();
        uint8 dec = ReactorToken(token).decimals();
        uint256 den = 10 ** dec;
        if (px == 0 || den == 0) return (0, false);
        mcapUsdc6 = FullMath.mulDiv(px, supply, den);
        ok = true;
    }

    function qualifiesTop10(address token) external view returns (bool) {
        (uint256 mcap, bool ok) = twapMcapUsdc(token);
        return ok && mcap >= ReactorConstants.TOP10_MCAP_FLOOR_USDC;
    }

    function _market(address token) internal view returns (address t, address quote, bool exists) {
        (t, quote, exists) = hook.marketOfToken(token);
    }

    function _spotUsdc1e6(address token, address quote) internal view returns (uint256) {
        (address t, address q, bool exists) = hook.marketOfToken(token);
        if (!exists) return 0;
        t;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token < quote ? token : quote),
            currency1: Currency.wrap(token < quote ? quote : token),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        bool zfo = token < quote;
        uint256 one = 10 ** ReactorToken(token).decimals();
        uint256 quoteOut = QuoteMath.expectedOut(sqrtP, one, zfo);
        if (q == usdc) return quoteOut;
        if (registry.get(quote).usdOracle == address(0)) return 0;
        return quoteOut;
    }
}
