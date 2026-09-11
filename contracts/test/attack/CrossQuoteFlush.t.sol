// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IERC20MinimalExt} from "../../src/interfaces/IERC20MinimalExt.sol";

/// @notice Swapper that leaves 6909 fee claims unflushed so flush() can be abused.
contract NoFlushSwapper is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager manager_) {
        poolManager = manager_;
    }

    function swap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, address recipient) external {
        poolManager.unlock(abi.encode(msg.sender, recipient, key, zeroForOne, amountSpecified));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        (address payer, address recipient, PoolKey memory key, bool zeroForOne, int256 amountSpecified) =
            abi.decode(raw, (address, address, PoolKey, bool, int256));
        IPoolManager.SwapParams memory p = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        BalanceDelta delta = IPoolManager(msg.sender).swap(key, p, "");
        _handle(key.currency0, payer, recipient, delta.amount0());
        _handle(key.currency1, payer, recipient, delta.amount1());
        return "";
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

/// @notice Reproduces then locks the cross-quote flush exploit.
contract CrossQuoteFlushTest is Base {
    NoFlushSwapper internal raw;

    function setUp() public override {
        super.setUp();
        raw = new NoFlushSwapper(pm);
    }

    /// @dev Historical reproduction of the two-arg flush mix-up. After P0 this path reverts.
    ///      The passing lock is `test_exploit_flushUsdcIntoZcat_mustRevert`.
    function test_reproduce_crossQuoteFlush_succeedsToday() public {
        vm.skip(true);
    }

    function test_canonicalFlushPaysOnlyMatchingQuote() public {
        address zcat = _instantZcat(80_000e8);
        _fillAndGraduate(alice, zcat);
        _rawBuy(alice, zcat, address(zec), 3_000e8);
        uint256 pending = hook.pendingTokenRewards(zcat);
        assertGt(pending, 0);
        usdc.mint(address(hook), 1_000e6);
        hook.flush(zcat);
        assertEq(IERC20Like(address(usdc)).balanceOf(zcat), 0, "USDC must not satisfy ZEC books");
        assertGt(IERC20Like(address(zec)).balanceOf(zcat), 0, "ZEC should land on ZCAT");
    }

    function test_exploit_flushUsdcIntoZcat_mustRevert() public {
        address zcat = _instantZcat(80_000e8);
        _fillAndGraduate(alice, zcat);
        _rawBuy(alice, zcat, address(zec), 3_000e8);

        uint256 pendingZec = hook.pendingTokenRewards(zcat);
        uint256 accruedZec = buyback.accrued(address(zec));
        assertGt(pendingZec, 0);

        usdc.mint(address(hook), 1_000e6);

        vm.expectRevert();
        hook.flush(address(usdc), zcat);

        assertEq(hook.pendingTokenRewards(zcat), pendingZec, "ZEC pending mutated");
        assertEq(buyback.accrued(address(zec)), accruedZec, "ZEC buyback mutated");
        assertEq(IERC20Like(address(usdc)).balanceOf(zcat), 0, "USDC paid to ZCAT");
    }

    function _rawBuy(address who, address token, address quote, uint256 amountIn) internal {
        vm.prank(who);
        IERC20Like(quote).approve(address(raw), amountIn);
        address c0 = token < quote ? token : quote;
        vm.prank(who);
        raw.swap(_key(token, quote), quote == c0, -int256(amountIn), who);
    }
}
