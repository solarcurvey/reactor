// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";

/// @notice Immutable official-LP owner. No withdraw, no upgrade, no admin sweep.
contract ReactorLiquidityVault is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public immutable owner;
    address public factory;

    mapping(PoolId => bool) public locked;
    mapping(PoolId => int24) public tickLowerOf;
    mapping(PoolId => int24) public tickUpperOf;

    event LiquidityLocked(PoolId indexed poolId, int24 tickLower, int24 tickUpper, int256 liquidityDelta);
    event FactoryBound(address factory);

    error NotFactory();
    error NotManager();
    error AlreadyBound();
    error WithdrawDisabled();
    error NotOwner();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    constructor(IPoolManager manager_) {
        poolManager = manager_;
        owner = msg.sender;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert AlreadyBound();
        if (factory_ == address(0)) revert NotFactory();
        factory = factory_;
        emit FactoryBound(factory_);
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
