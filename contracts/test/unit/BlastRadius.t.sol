// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorConstants} from "../../src/ReactorConstants.sol";

/// @notice Keeper cannot drain an entire pot in one call.
contract BlastRadiusTest is Base {
    function test_flywheelSettle_chunksNotFullPot() public {
        uint256 pot = 1_000_000e6;
        usdc.mint(address(flywheel), pot);
        vm.prank(address(hook));
        flywheel.accrue(address(usdc), pot);
        uint256 before = flywheel.quoteAccrued(address(usdc));
        vm.prank(keeper);
        flywheel.settleQuote(address(usdc), _emptyHops(), 0);
        uint256 afterAcc = flywheel.quoteAccrued(address(usdc));
        uint256 moved = before - afterAcc;
        assertLt(moved, before, "must leave remainder");
        assertLe(moved, (before * uint256(ReactorConstants.MAX_CHUNK_BPS)) / ReactorConstants.BPS_DENOMINATOR);
    }

    function test_selfBurn_chunksNotFullPot() public {
        (address token,) = factory.launchStandard(
            ReactorFactory.InstantParams({
                name: "SB",
                symbol: "SB",
                decimals: 18,
                supply: 0,
                quote: address(usdc),
                fdvQuoteRaw: 0,
                devBuyQuote: 0,
                image: "",
                description: "",
                website: "",
                twitter: "",
                telegram: ""
            })
        );
        uint256 pot = 500_000e6;
        usdc.mint(address(selfBurn), pot);
        vm.prank(address(hook));
        selfBurn.accrue(token, address(usdc), pot);
        uint256 before = selfBurn.accrued(token);
        vm.prank(keeper);
        selfBurn.execute(token, 1);
        uint256 afterAcc = selfBurn.accrued(token);
        uint256 spent = before - afterAcc;
        assertLt(spent, before);
        assertLe(spent, (before * uint256(ReactorConstants.MAX_CHUNK_BPS)) / ReactorConstants.BPS_DENOMINATOR);
    }
}
