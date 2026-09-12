// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";

/// @notice Immutable official-LP owner. No withdraw, no upgrade, no admin sweep.
contract ReactorLiquidityVault is IUnlockCallback {
    IPoolManager public immutable poolManager;
    ReactorGuardian public immutable auth;
    address public factory;
    address public curve;
    address public launchModule;

    mapping(PoolId => bool) public locked;
    mapping(PoolId => int24) public tickLowerOf;
    mapping(PoolId => int24) public tickUpperOf;

    event LiquidityLocked(PoolId indexed poolId, int24 tickLower, int24 tickUpper, int256 liquidityDelta);
    event FactoryBound(address factory);

    error NotFactory();
    error NotManager();
    error AlreadyBound();
    error WithdrawDisabled();
    error NotGuardian();

    modifier onlyFactory() {
        if (msg.sender != factory && msg.sender != curve && msg.sender != launchModule) revert NotFactory();
        _;
    }

    constructor(IPoolManager manager_, ReactorGuardian auth_) {
        poolManager = manager_;
        auth = auth_;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != auth.guardian()) revert NotGuardian();
        if (factory != address(0)) revert AlreadyBound();
        if (factory_ == address(0)) revert NotFactory();
        factory = factory_;
        emit FactoryBound(factory_);
    }

    function bindCurve(address curve_) external {
        if (msg.sender != factory) revert NotFactory();
        if (curve != address(0)) revert AlreadyBound();
        if (curve_ == address(0)) revert NotFactory();
        curve = curve_;
    }

    function bindLaunchModule(address m) external {
        if (msg.sender != factory && msg.sender != auth.guardian()) revert NotFactory();
        if (launchModule != address(0)) revert AlreadyBound();
        if (m == address(0)) revert NotFactory();
        launchModule = m;
    }

    /// @notice Add liquidity owned by this vault. Tokens must already sit here.
    function lockLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidityDelta)
        external
        onlyFactory
        returns (BalanceDelta delta)
    {
        bytes memory ret = poolManager.unlock(abi.encode(key, tickLower, tickUpper, liquidityDelta));
        delta = abi.decode(ret, (BalanceDelta));
        PoolId id = key.toId();
        locked[id] = true;
        tickLowerOf[id] = tickLower;
        tickUpperOf[id] = tickUpper;
        emit LiquidityLocked(id, tickLower, tickUpper, liquidityDelta);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotManager();
        (PoolKey memory key, int24 tickLower, int24 tickUpper, int256 liquidityDelta) =
            abi.decode(data, (PoolKey, int24, int24, int256));
        if (liquidityDelta < 0) revert WithdrawDisabled();

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: liquidityDelta, salt: bytes32(0)
            }),
            ""
        );
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 amount) internal {
        if (amount == 0) return;
        address token = Currency.unwrap(currency);
        if (amount < 0) {
            uint256 owe = uint256(uint128(-amount));
            poolManager.sync(currency);
            IERC20MinimalExt(token).transfer(address(poolManager), owe);
            poolManager.settle();
        } else {
            poolManager.take(currency, address(this), uint256(uint128(amount)));
        }
    }
}
