// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal ABIs for EOA `completeGenesis` wiring. Selectors match the live contracts
///         (contract/interface/enum types encode as address/uint8).
interface IQuoteGenesis {
    function setUsdc(address usdc_) external;
    function register(
        address token,
        string calldata symbol,
        string calldata name,
        uint8 decimals,
        string calldata icon,
        uint8 category
    ) external;
    function setUsdPegOne(address token, bool peg) external;
    function setBuybackRoute(address token, bool enabled, bool hopViaUsdc_) external;
    function bindFactory(address factory_) external;
    function usdc() external view returns (address);
    function factory() external view returns (address);
    function isUsdPegOne(address token) external view returns (bool);
}

interface IHookGenesis {
    function bindCoreVault(address vault_) external;
    function bindBuyback(address vault_) external;
    function bindFlywheel(address vault_) external;
    function bindFactory(address factory_) external;
    function bindLaunchModule(address m) external;
    function bindCurve(address curve_) external;
    function bindSelfBurn(address vault_) external;
    function factory() external view returns (address);
    function launchModule() external view returns (address);
    function curve() external view returns (address);
    function coreLpVault() external view returns (address);
}

interface ICoreLpGenesis {
    function initializeAndLock() external;
    function locked() external view returns (bool);
}

interface IVaultGenesis {
    function bindFactory(address factory_) external;
    function bindLaunchModule(address m) external;
    function factory() external view returns (address);
    function launchModule() external view returns (address);
}

interface IFactoryGenesis {
    function bindCurve(address curve_, address selfBurn_) external;
    function bindLaunchModule(address m) external;
    function curve() external view returns (address);
    function launchModule() external view returns (address);
    function selfBurn() external view returns (address);
    function instantCurveConfig() external view returns (bytes32);
}

interface IFlywheelGenesis {
    function bind(address factory_) external;
    function factory() external view returns (address);
}

interface IBuybackGenesis {
    function bindFactory(address factory_) external;
    function bindExecutor(address executor_) external;
    function factory() external view returns (address);
    function executor() external view returns (address);
}

interface IRouterGenesis {
    function setProtocolVault(address vault, bool allowed) external;
    function sealProtocolVaults() external;
    function protocolVaultsSealed() external view returns (bool);
    function protocolVault(address) external view returns (bool);
}

interface ICurveGenesis {
    function bindRouteExecutor(address exec) external;
    function routeExecutor() external view returns (address);
}

interface IVestingGenesis {
    function activateLaunch() external;
    function t0() external view returns (uint64);
    function auth() external view returns (address);
}

interface ITickerGenesis {
    function authorizeFactory(address factory, uint32 version) external;
    function isActiveFactory(address factory) external view returns (bool);
    function factoryVersionOf(address factory) external view returns (uint32);
}

interface ICoreTokenView {
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}
