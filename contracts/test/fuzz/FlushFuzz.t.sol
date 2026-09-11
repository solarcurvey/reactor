// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorHook} from "../../src/ReactorHook.sol";
import {MockERC20} from "../../src/MockERC20.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";

contract FlushFuzzTest is Base {
    function testFuzz_flushRejectsArbitraryPair(address spoof, uint8 dec) public {
        dec = uint8(bound(dec, 6, 18));
        address zcat = _instantZcat(40_000e8);
        _buy(alice, zcat, address(zec), 400e8);
        MockERC20 junk = new MockERC20("J", "J", dec, 0, address(this));
        if (spoof == zcat || spoof == address(0)) spoof = address(junk);
        vm.expectRevert();
        hook.flush(spoof, zcat);
        vm.expectRevert();
        hook.flush(address(junk));
        hook.flush(zcat);
    }

    function testFuzz_flushCallerOrder(address caller) public {
        vm.assume(caller != address(0));
        address zcat = _instantZcat(40_000e8);
        _buy(alice, zcat, address(zec), 300e8);
        vm.prank(caller);
        hook.flush(zcat);
    }

    function test_multiQuoteFlushIsolation() public {
        address zcat = _instantZcat(40_000e8);
        (address ucat,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "U",
                symbol: "U",
                decimals: 18,
                supply: 1_000_000_000 ether,
                quote: address(usdc),
                fdvQuoteRaw: 10_000e6,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        _buy(alice, zcat, address(zec), 800e8);
        _buy(bob, ucat, address(usdc), 800e6);
        hook.flush(zcat);
        hook.flush(ucat);
        assertEq(ReactorTokenLike(zcat).quoteAsset(), address(zec));
        assertEq(ReactorTokenLike(ucat).quoteAsset(), address(usdc));
    }
}

interface ReactorTokenLike {
    function quoteAsset() external view returns (address);
}
