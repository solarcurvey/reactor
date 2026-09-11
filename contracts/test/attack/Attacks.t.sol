// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorToken} from "../../src/ReactorToken.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {MockERC20} from "../../src/MockERC20.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";

contract AttacksTest is Base {
    function test_doubleClaim() public {
        address token = _instantZcat(40_000e8);
        _buy(alice, token, address(zec), 2_000e8);
        vm.prank(alice);
        ReactorToken(token).claimRewards(alice);
        vm.prank(alice);
        assertEq(ReactorToken(token).claimRewards(alice), 0);
    }

    function test_balanceHopDoesNotSteal() public {
        address token = _instantZcat(40_000e8);
        _buy(alice, token, address(zec), 3_000e8);
        uint256 pAlice = ReactorToken(token).pendingRewards(alice);
        uint256 bal = ReactorToken(token).balanceOf(alice);
        vm.prank(alice);
        ReactorToken(token).transfer(bob, bal);
        vm.prank(bob);
        ReactorToken(token).transfer(alice, bal);
        assertApproxEqAbs(ReactorToken(token).pendingRewards(alice), pAlice, 1);
        assertLe(ReactorToken(token).pendingRewards(bob), 1);
    }

    function test_exactInExactOutBothSorts() public {
        address token = _instantZcat(60_000e8);
        _buy(alice, token, address(zec), 1_000e8);
        uint256 tok = ReactorToken(token).balanceOf(alice);
        _sell(alice, token, address(zec), tok / 5);

        (address ucat,) = _instant(
            ReactorFactory.InstantParams({
                name: "Q",
                symbol: "Q",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 15_000e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _buy(bob, ucat, address(usdc), 800e6);
        _sell(bob, ucat, address(usdc), ReactorToken(ucat).balanceOf(bob) / 3);
    }

    function test_fotQuoteNotRegistered() public {
        MockERC20 fot = new MockERC20("FoT", "FOT", 6, 0, address(this));
        vm.expectRevert();
        _instant(
            ReactorFactory.InstantParams({
                name: "X",
                symbol: "X",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(fot),
                fdvQuoteRaw: 1e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
    }

    function test_dustFeeZero() public pure {
        (,,, uint256 f) = FeeMath.split(2);
        assertEq(f, 0);
    }
}
