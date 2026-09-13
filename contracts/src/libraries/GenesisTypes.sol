// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library GenesisTypes {
    /// @notice Batch-A addresses after `SAFE_GENESIS` constructors. `deployer` is isolation-only.
    struct Wiring {
        address pricingSigner;
        address launchSigner;
        address deployer;
        address tickers;
        address factory;
        address registry;
        address usdc;
        address hook;
        address coreLp;
        address userAdapter;
        address protocolAdapter;
        address buyback;
        address flywheel;
        address launchModule;
        address vault;
        address curve;
        address selfBurn;
        address coreBuyback;
        address router;
        address userRouter;
        address vesting;
        address core;
    }
}
