// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";

/// @notice Unlock-callback router. V1 swaps are exact-input only with a nonzero minOut.
contract ReactorRouter is IUnlockCallback {
    IPoolManager public immutable poolManager;
    ReactorGuardian public immutable auth;
    bool public protocolVaultsSealed;

    mapping(address => bool) public protocolVault;
    uint256 public protocolExempt;
    uint256 private reentrancyLock;

    error NotManager();
    error Slippage();
    error ZeroAmount();
    error FlushFailed(bytes data);
    error ExactOutDisabled();
    error MinOutRequired();
    error IncompleteFill();
    error NotVault();
    error NotGuardian();
    error Sealed();
    error WalletExemptForbidden();
    error Reentrant();

    modifier nonReentrant() {
        if (reentrancyLock == 1) revert Reentrant();
        reentrancyLock = 1;
        _;
        reentrancyLock = 0;
    }

    event ProtocolVaultSet(address indexed vault, bool allowed);
    event ProtocolVaultsSealed();

    constructor(IPoolManager manager_, ReactorGuardian auth_) {
        poolManager = manager_;
        auth = auth_;
    }

    /// @notice Guardian one-shot deploy wiring. Cannot mark an EOA. Nobody can call after seal.
    function setProtocolVault(address vault, bool allowed) external {
        if (protocolVaultsSealed) revert Sealed();
        if (msg.sender != auth.guardian()) revert NotGuardian();
        if (allowed && vault.code.length == 0) revert WalletExemptForbidden();
        protocolVault[vault] = allowed;
        emit ProtocolVaultSet(vault, allowed);
    }

    function sealProtocolVaults() external {
        if (msg.sender != auth.guardian()) revert NotGuardian();
        protocolVaultsSealed = true;
        emit ProtocolVaultsSealed();
    }

    /// @param amountSpecified must be negative (exact in). Exact-out is disabled in V1.
    function swap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint256 minOut, address recipient)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (protocolExempt != 0) revert WalletExemptForbidden();
        return _swap(msg.sender, key, zeroForOne, amountSpecified, minOut, recipient);
    }

    /// @notice Self-burn / Top-10 / CORE vaults only. Sets a storage latch the hook reads.
    /// `nonReentrant` blocks ERC-20 / unlock callbacks from riding the exempt window
    /// for a fee-free user `swap` or nested `protocolSwap`. Revert rolls the latch back.
    /// Codex audit target: latch + lock pairing — see AUDIT_HANDOFF.
    function protocolSwap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint256 minOut, address recipient)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (!protocolVault[msg.sender]) revert NotVault();
        protocolExempt = 1;
        amountOut = _swap(msg.sender, key, zeroForOne, amountSpecified, minOut, recipient);
        protocolExempt = 0;
    }

    function _swap(
        address payer,
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint256 minOut,
        address recipient
    ) internal returns (uint256 amountOut) {
        if (amountSpecified == 0) revert ZeroAmount();
        if (amountSpecified > 0) revert ExactOutDisabled();
        if (minOut == 0) revert MinOutRequired();
        bytes memory ret = poolManager.unlock(
            abi.encode(
                uint8(0), payer, recipient, key, zeroForOne, amountSpecified, minOut, int24(0), int24(0), int256(0)
            )
        );
        amountOut = abi.decode(ret, (uint256));
        _flushHook(key);
    }

    function addLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidityDelta)
        external
        nonReentrant
        returns (BalanceDelta delta)
    {
        bytes memory ret = poolManager.unlock(
            abi.encode(
                uint8(1),
                msg.sender,
                msg.sender,
                key,
                false,
                int256(0),
                uint256(0),
                tickLower,
                tickUpper,
                liquidityDelta
            )
        );
        delta = abi.decode(ret, (BalanceDelta));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotManager();
        (
            uint8 action,
            address payer,
            address recipient,
            PoolKey memory key,
            bool zeroForOne,
            int256 amountSpecified,
            uint256 minOut,
            int24 tickLower,
            int24 tickUpper,
            int256 liquidityDelta
        ) = abi.decode(raw, (uint8, address, address, PoolKey, bool, int256, uint256, int24, int24, int256));

        if (action == 1) {
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: liquidityDelta,
                    salt: bytes32(uint256(uint160(payer)))
                }),
                ""
            );
            _handle(key.currency0, payer, recipient, d.amount0());
            _handle(key.currency1, payer, recipient, d.amount1());
            return abi.encode(d);
        }

        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        _handle(key.currency0, payer, recipient, delta.amount0());
        _handle(key.currency1, payer, recipient, delta.amount1());

        int128 inDelta = zeroForOne ? delta.amount0() : delta.amount1();
        if (inDelta >= 0) revert Slippage();
        uint256 paid = uint256(uint128(-inDelta));
        uint256 want = uint256(-amountSpecified);
        if (paid < want) revert IncompleteFill();

        uint256 outAmt;
        if (zeroForOne) {
            if (delta.amount1() < 0) revert Slippage();
            outAmt = uint256(uint128(delta.amount1()));
        } else {
            if (delta.amount0() < 0) revert Slippage();
            outAmt = uint256(uint128(delta.amount0()));
        }
        if (outAmt < minOut) revert Slippage();
        return abi.encode(outAmt);
    }

    function _flushHook(PoolKey memory key) internal {
        address h = address(key.hooks);
        if (h == address(0)) return;
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        // Canonical flush(token). One of the two currencies is the launch token.
        (bool ok0,) = h.call(abi.encodeWithSignature("flush(address)", c0));
        (bool ok1,) = h.call(abi.encodeWithSignature("flush(address)", c1));
        if (!ok0 && !ok1) revert FlushFailed(bytes("flush"));
    }

    function _handle(Currency currency, address payer, address recipient, int128 amount) internal {
        if (amount == 0) return;
        address token = Currency.unwrap(currency);
        if (amount < 0) {
            uint256 owe = uint256(uint128(-amount));
            poolManager.sync(currency);
            IERC20MinimalExt(token).transferFrom(payer, address(poolManager), owe);
            poolManager.settle();
        } else {
            poolManager.take(currency, recipient, uint256(uint128(amount)));
        }
    }
}
