// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, IERC20Like} from "../Base.sol";
import {ReactorLiquidityVault} from "../../src/ReactorLiquidityVault.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

contract LockAndBuybackTest is Base {
    function test_creatorCannotReclaimLp() public {
        address token = _instantZcat(50_000e8);
        PoolKey memory key = _key(token, address(zec));
        vm.expectRevert(ReactorLiquidityVault.NotFactory.selector);
        vault.lockLiquidity(key, -60, 60, -1);
        vm.prank(alice);
        vm.expectRevert(ReactorLiquidityVault.NotFactory.selector);
        vault.lockLiquidity(key, -60, 60, 1);
    }

    function test_buybackCannotRedirect() public {
        assertEq(buyback.core(), address(core));
        vm.prank(alice);
        vm.expectRevert();
        buyback.execute(address(usdc), _emptyHops(), 1);
    }

    function test_hookBits() public view {
        assertEq(uint160(address(hook)) & 0x3FFF, hook.hookFlags());
    }

    function test_buybackUsdcLaunch() public {
        (address ucat,) = _instant(
            ReactorFactory.InstantParams({
                name: "U",
                symbol: "U",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 20_000e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _buy(alice, ucat, address(usdc), 5_000e6);
        uint256 acc = buyback.accrued(address(usdc));
        uint256 supplyBefore = core.totalSupply();
        _keeperCore(address(usdc));
        assertLt(core.totalSupply(), supplyBefore);
        assertGt(buyback.lifetimeBurned(), 0);
        assertLt(buyback.accrued(address(usdc)), acc);
    }

    function test_pendingZecRoute() public {
        address token = _instantZcat(80_000e8);
        _buy(alice, token, address(zec), 10_000e8);
        uint256 before = buyback.accrued(address(zec));
        assertGt(before, 0);
        uint256 supplyBefore = core.totalSupply();
        _keeperCore(address(zec));
        assertLt(core.totalSupply(), supplyBefore);
        assertGt(buyback.lifetimeBurned(), 0);
        assertLt(buyback.accrued(address(zec)), before);
    }
}
