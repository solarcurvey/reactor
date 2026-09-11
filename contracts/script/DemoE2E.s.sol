// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ReactorFactory} from "../src/ReactorFactory.sol";
import {ReactorRouter} from "../src/ReactorRouter.sol";
import {ReactorToken} from "../src/ReactorToken.sol";
import {BuybackVault} from "../src/BuybackVault.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

/// @notice Post-deploy economic loop. Reads addresses from env.
contract DemoE2E is Script {
    function run() external {
        uint256 pk = vm.envOr("DEPLOYER_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address factoryAddr = vm.envAddress("FACTORY");
        address routerAddr = vm.envAddress("ROUTER");
        address buybackAddr = vm.envAddress("BUYBACK");
        address zecAddr = vm.envAddress("ZEC");
        address usdcAddr = vm.envAddress("USDC");
        address hookAddr = vm.envAddress("HOOK");

        ReactorFactory factory = ReactorFactory(factoryAddr);
        ReactorRouter router = ReactorRouter(routerAddr);
        BuybackVault buyback = BuybackVault(buybackAddr);
        MockERC20 zec = MockERC20(zecAddr);
        MockERC20 usdc = MockERC20(usdcAddr);

        address alice = vm.addr(pk);
        uint256 bobPk = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        address bob = vm.addr(bobPk);

        vm.startBroadcast(pk);
        zec.mint(alice, 1_000_000e8);
        zec.mint(bob, 1_000_000e8);
        usdc.mint(alice, 1_000_000e6);

        (address zcat,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "Zcash Cat",
                symbol: "ZCAT",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: zecAddr,
                fdvQuoteRaw: 80_000e8,
                devBuyQuote: 0,
                image: "/metadata/zcat.svg",
                description: "Official REACTOR instant launch against Mock ZEC.",
                website: "https://reactor.local",
                twitter: "",
                telegram: ""
            })
        );
        _buy(router, hookAddr, zcat, zecAddr, 5_000e8, alice);
        vm.stopBroadcast();

        vm.startBroadcast(bobPk);
        zec.approve(routerAddr, type(uint256).max);
        _buy(router, hookAddr, zcat, zecAddr, 2_000e8, bob);
        vm.stopBroadcast();

        vm.startBroadcast(pk);
        uint256 sellAmt = ReactorToken(zcat).balanceOf(alice) / 10;
        ReactorToken(zcat).approve(routerAddr, sellAmt);
        _sell(router, hookAddr, zcat, zecAddr, sellAmt, alice);
        ReactorToken(zcat).transfer(bob, 1 ether);
        ReactorToken(zcat).claimRewards(alice);
        console2.log("ZCAT", zcat);
        console2.log("ZCAT pending alice", ReactorToken(zcat).pendingRewards(alice));
        console2.log("buyback ZEC", buyback.accrued(zecAddr));

        (address fcat, uint256 fairId) = factory.createFairLaunch(
            ReactorFactory.FairParams({
                name: "Fair Cat",
                symbol: "FCAT",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: zecAddr,
                duration: 1,
                auctionBps: 5_000,
                minRaise: 0,
                image: "",
                description: "Fair launch demo",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        zec.approve(factoryAddr, 1_000e8);
        factory.bid(fairId, 1_000e8);
        vm.stopBroadcast();

        vm.startBroadcast(bobPk);
        zec.approve(factoryAddr, 1_500e8);
        factory.bid(fairId, 1_500e8);
        vm.stopBroadcast();

        vm.warp(block.timestamp + 2);
        vm.startBroadcast(pk);
        factory.finalizeFairLaunch(fairId);
        factory.claimFairTokens(fairId, alice);
        _buy(router, hookAddr, fcat, zecAddr, 100e8, alice);
        console2.log("FCAT", fcat);
        console2.log("fairId", fairId);
        vm.stopBroadcast();
    }

    function _buy(ReactorRouter router, address hook, address token, address quote, uint256 amt, address who) internal {
        PoolKey memory key = _key(hook, token, quote);
        quote;
        who;
        bool zfo = quote < token ? true : false;
        if (quote > token) zfo = false;
        zfo = !(token < quote);
        // pay quote: zeroForOne if quote is token0
        zfo = quote < token;
        IERC20Like(quote).approve(address(router), amt);
        router.swap(key, zfo, -int256(amt), 0, who);
    }

    function _sell(ReactorRouter router, address hook, address token, address quote, uint256 amt, address who)
        internal
    {
        PoolKey memory key = _key(hook, token, quote);
        bool zfo = token < quote;
        router.swap(key, zfo, -int256(amt), 0, who);
    }

    function _key(address hook, address token, address quote) internal pure returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(token < quote ? token : quote),
            currency1: Currency.wrap(token < quote ? quote : token),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(hook)
        });
    }
}

interface IERC20Like {
    function approve(address, uint256) external returns (bool);
}