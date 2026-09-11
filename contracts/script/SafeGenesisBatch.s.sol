// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ReactorGuardian} from "../src/ReactorGuardian.sol";
import {InstantCurve} from "../src/InstantCurve.sol";
import {CoreVesting} from "../src/CoreVesting.sol";
import {CoreLiquidityVault} from "../src/CoreLiquidityVault.sol";
import {QuoteAssetRegistry} from "../src/QuoteAssetRegistry.sol";
import {ReactorFactory} from "../src/ReactorFactory.sol";
import {ReactorHook} from "../src/ReactorHook.sol";
import {ReactorLiquidityVault} from "../src/ReactorLiquidityVault.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {FlywheelVault} from "../src/FlywheelVault.sol";
import {ReactorRouter} from "../src/ReactorRouter.sol";
import {SelfBurnVault} from "../src/SelfBurnVault.sol";
import {CoreBuybackExecutor} from "../src/CoreBuybackExecutor.sol";

/// @notice FULL Guardian MultiSend of remaining genesis ops after SAFE_GENESIS constructors.
/// Deployer ≠ Safe. Safe executes. VerifyGenesis. Then pauseLaunches(false) LAST.
///
/// forge script script/SafeGenesisBatch.s.sol:SafeGenesisBatch --rpc-url $RPC
contract SafeGenesisBatch is Script {
    function run() external view {
        address safe = vm.envAddress("EXPECTED_SAFE");
        address deployer = vm.envAddress("DEPLOYER");
        address pricingSigner = vm.envAddress("EXPECTED_PRICING_SIGNER");
        address keeper = vm.envAddress("EXPECTED_KEEPER");
        ReactorGuardian auth = ReactorGuardian(vm.envAddress("GUARDIAN_CONTRACT"));
        require(auth.guardian() == safe, "guardian != Safe");
        require(safe != deployer, "Safe must not be deployer");
        require(pricingSigner != keeper && pricingSigner != safe && pricingSigner != deployer, "pricing key reuse");
        require(auth.launchesPaused(), "must stay paused until Safe T0");

        address registry = vm.envAddress("REGISTRY");
        address usdc = vm.envAddress("USDC");
        address hook = vm.envAddress("HOOK");
        address factory = vm.envAddress("FACTORY");
        address vault = vm.envAddress("VAULT");
        address flywheel = vm.envAddress("FLYWHEEL");
        address buyback = vm.envAddress("BUYBACK");
        address curve = vm.envAddress("CURVE");
        address selfBurn = vm.envAddress("SELF_BURN");
        address userRouter = vm.envAddress("USER_ROUTER");
        address userAdapter = vm.envAddress("USER_ADAPTER");
        address protocolAdapter = vm.envAddress("PROTOCOL_ADAPTER");
        address coreLp = vm.envAddress("CORE_LP");
        address coreBuyback = vm.envAddress("CORE_BUYBACK");
        address router = vm.envAddress("ROUTER");
        address vesting = vm.envAddress("VESTING");

        console2.log("SAFE_GENESIS_BATCH - execute in this order as Safe MultiSend");
        console2.log("Safe", safe);

        console2.log("BATCH A - config while paused (do not unpause)");
        address launchSigner = vm.envOr("EXPECTED_LAUNCH_SIGNER", pricingSigner);
        address tickers = vm.envAddress("TICKER_REGISTRY");
        require(launchSigner != keeper && launchSigner != safe && launchSigner != deployer, "launch key reuse");
        _log(
            "setPricingSigner",
            address(auth),
            abi.encodeWithSelector(ReactorGuardian.setPricingSigner.selector, pricingSigner)
        );
        _log(
            "setLaunchSigner",
            address(auth),
            abi.encodeWithSelector(ReactorGuardian.setLaunchSigner.selector, launchSigner)
        );
        _log(
            "bindTickerRegistry",
            address(auth),
            abi.encodeWithSelector(ReactorGuardian.bindTickerRegistry.selector, tickers)
        );
        _log(
            "authorizeFactory V1",
            address(auth),
            abi.encodeWithSelector(ReactorGuardian.authorizeFactory.selector, factory, uint32(1))
        );
        _log("setUsdc", registry, abi.encodeWithSelector(QuoteAssetRegistry.setUsdc.selector, usdc));
        _log(
            "register USDC",
            registry,
            abi.encodeWithSelector(
                QuoteAssetRegistry.register.selector,
                usdc,
                "USDC",
                "USD Coin",
                uint8(6),
                "",
                QuoteAssetRegistry.Category.Stablecoins
            )
        );
        _log(
            "setUsdPegOne USDC", registry, abi.encodeWithSelector(QuoteAssetRegistry.setUsdPegOne.selector, usdc, true)
        );
        _log(
            "setBuybackRoute USDC",
            registry,
            abi.encodeWithSelector(QuoteAssetRegistry.setBuybackRoute.selector, usdc, true, false)
        );
        _log("bindCoreVault", hook, abi.encodeWithSelector(ReactorHook.bindCoreVault.selector, coreLp));
        _log("initializeAndLock", coreLp, abi.encodeWithSelector(CoreLiquidityVault.initializeAndLock.selector));
        _log(
            "setAdapter user",
            address(auth),
            abi.encodeWithSelector(ReactorGuardian.setAdapter.selector, userAdapter, true)
        );
        _log(
            "setAdapter protocol",
            address(auth),
            abi.encodeWithSelector(ReactorGuardian.setAdapter.selector, protocolAdapter, true)
        );
        _log("bindBuyback", hook, abi.encodeWithSelector(ReactorHook.bindBuyback.selector, buyback));
        _log("bindFlywheel", hook, abi.encodeWithSelector(ReactorHook.bindFlywheel.selector, flywheel));
        _log("hook.bindFactory", hook, abi.encodeWithSelector(ReactorHook.bindFactory.selector, factory));
        _log("vault.bindFactory", vault, abi.encodeWithSelector(ReactorLiquidityVault.bindFactory.selector, factory));
        _log("registry.bindFactory", registry, abi.encodeWithSelector(QuoteAssetRegistry.bindFactory.selector, factory));
        _log("flywheel.bind", flywheel, abi.encodeWithSelector(FlywheelVault.bind.selector, factory));
        _log("buyback.bindFactory", buyback, abi.encodeWithSelector(BuybackVault.bindFactory.selector, factory));
        _log("factory.bindCurve", factory, abi.encodeWithSelector(ReactorFactory.bindCurve.selector, curve, selfBurn));
        _log("hook.bindCurve", hook, abi.encodeWithSelector(ReactorHook.bindCurve.selector, curve));
        _log("hook.bindSelfBurn", hook, abi.encodeWithSelector(ReactorHook.bindSelfBurn.selector, selfBurn));
        _log("bindExecutor", buyback, abi.encodeWithSelector(BuybackVault.bindExecutor.selector, coreBuyback));
        _log(
            "setProtocolVault selfBurn",
            router,
            abi.encodeWithSelector(ReactorRouter.setProtocolVault.selector, selfBurn, true)
        );
        _log(
            "setProtocolVault flywheel",
            router,
            abi.encodeWithSelector(ReactorRouter.setProtocolVault.selector, flywheel, true)
        );
        _log(
            "setProtocolVault coreBuyback",
            router,
            abi.encodeWithSelector(ReactorRouter.setProtocolVault.selector, coreBuyback, true)
        );
        _log(
            "setProtocolVault protocolAdapter",
            router,
            abi.encodeWithSelector(ReactorRouter.setProtocolVault.selector, protocolAdapter, true)
        );
        _log("sealProtocolVaults", router, abi.encodeWithSelector(ReactorRouter.sealProtocolVaults.selector));
        _log("bindRouteExecutor", curve, abi.encodeWithSelector(InstantCurve.bindRouteExecutor.selector, userRouter));
        console2.log("VERIFY - run VerifyGenesis / verifyFullyWired while still paused");
        console2.log("BATCH B - vesting T0 + unpause (only after verify)");
        _log("activateLaunch", vesting, abi.encodeWithSelector(CoreVesting.activateLaunch.selector));
        _log(
            "pauseLaunches(false) LAST after VerifyGenesis",
            address(auth),
            abi.encodeWithSelector(ReactorGuardian.pauseLaunches.selector, false)
        );
        console2.log("Deployer cannot call any of these. Batch A config, verify, then Batch B.");
    }

    function _log(string memory label, address to, bytes memory data) internal pure {
        console2.log(label);
        console2.logAddress(to);
        console2.logBytes(data);
    }
}
