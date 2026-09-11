// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IERC20MinimalExt} from "./interfaces/IERC20MinimalExt.sol";
import {IReactorSwapper} from "./interfaces/IReactorSwapper.sol";
import {ReactorGuardian} from "./ReactorGuardian.sol";
import {ReactorConstants} from "./ReactorConstants.sol";

/// @notice Only protocol-exempt path for official CORE/USDC maintenance buys. Not the Keeper EOA.
contract CoreBuybackExecutor {
    ReactorGuardian public immutable auth;
    IHooks public immutable hook;
    IReactorSwapper public immutable router;
    address public immutable core;
    address public immutable usdc;
    address public immutable buyback;

    error NotBuyback();
    error MinOutRequired();
    error Bad();

    constructor(
        ReactorGuardian auth_,
        IHooks hook_,
        IReactorSwapper router_,
        address core_,
        address usdc_,
        address buyback_
    ) {
        if (address(auth_) == address(0) || address(hook_) == address(0) || address(router_) == address(0)) revert Bad();
        if (core_ == address(0) || usdc_ == address(0) || buyback_ == address(0)) revert Bad();
        auth = auth_;
        hook = hook_;
        router = router_;
        core = core_;
        usdc = usdc_;
        buyback = buyback_;
    }

    function officialKey() public view returns (PoolKey memory key) {
        address a = core < usdc ? core : usdc;
        address b = core < usdc ? usdc : core;
        key = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: ReactorConstants.LP_FEE,
            tickSpacing: ReactorConstants.TICK_SPACING,
            hooks: hook
        });
    }

    /// @notice Pull USDC from BuybackVault, protocolSwap for CORE, send CORE back. Fee-exempt latch.
    function buy(uint256 usdcIn, uint256 minTargetOut) external returns (uint256 coreOut) {
        if (msg.sender != buyback) revert NotBuyback();
        if (usdcIn == 0 || minTargetOut == 0) revert MinOutRequired();
        IERC20MinimalExt(usdc).transferFrom(msg.sender, address(this), usdcIn);
        IERC20MinimalExt(usdc).approve(address(router), usdcIn);
        coreOut = router.protocolSwap(officialKey(), usdc < core, -int256(usdcIn), minTargetOut, msg.sender);
        IERC20MinimalExt(usdc).approve(address(router), 0);
    }
}
