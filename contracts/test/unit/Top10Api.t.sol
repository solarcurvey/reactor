// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {Top10Ranker} from "../../src/libraries/Top10Ranker.sol";

/// @notice Offchain ranker + onchain structural submit. Material vs irrelevant inactivity.
contract Top10ApiTest is Base {
    function _tok(string memory s) internal returns (address token) {
        (token,) = _instant(
            ReactorFactory.InstantParams({
                name: s,
                symbol: s,
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
    }

    function test_43_skipUngraduated() public {
        address token = _tok("U");
        Top10Ranker.Candidate[] memory arr = _one(token, false, false, 400_000e6, true);
        (address[] memory t, uint256[] memory w, bool pause) = Top10Ranker.rank(arr, 250_000e6);
        assertEq(t.length, 0);
        assertEq(w.length, 0);
        assertFalse(pause);
    }

    function test_43_skipCore() public {
        Top10Ranker.Candidate[] memory arr = _one(address(core), true, true, 9_000_000e6, true);
        (address[] memory t,, bool pause) = Top10Ranker.rank(arr, 250_000e6);
        assertEq(t.length, 0);
        assertFalse(pause);
    }

    function test_irrelevantInactivityDoesNotPause() public {
        address token = _tok("DEAD");
        _fillAndGraduate(alice, token);
        Top10Ranker.Candidate memory c = Top10Ranker.cand(token, true, false, 0, false);
        c.tradeCount = 1;
        c.lastGoodMarkUsdc = 12_000e6;
        c.liquidityUsdc = 800e6;
        Top10Ranker.Candidate[] memory arr = new Top10Ranker.Candidate[](1);
        arr[0] = c;
        (address[] memory t,, bool pause) = Top10Ranker.rank(arr, 250_000e6);
        assertEq(t.length, 0);
        assertFalse(pause, "dead low-value graduate must not freeze the epoch");
    }

    function test_materialUnvaluedPausesEvenIfOthersQualify() public {
        address a = _tok("LIVE");
        address b = _tok("MAT");
        _fillAndGraduate(alice, a);
        _fillAndGraduate(alice, b);
        Top10Ranker.Candidate[] memory arr = new Top10Ranker.Candidate[](2);
        arr[0] = Top10Ranker.cand(a, true, false, 400_000e6, true);
        arr[1] = Top10Ranker.cand(b, true, false, 0, false);
        arr[1].lastGoodMarkUsdc = 500_000e6;
        arr[1].priorRanked = true;
        (address[] memory t,, bool pause) = Top10Ranker.rank(arr, 250_000e6);
        assertEq(t.length, 0);
        assertTrue(pause, "material candidate without a mark pauses the epoch");
    }

    function test_thousandsOfInactiveMarketsDoNotFreeze() public {
        address live = _tok("Q");
        _fillAndGraduate(alice, live);
        uint256 n = 2000;
        Top10Ranker.Candidate[] memory arr = new Top10Ranker.Candidate[](n + 1);
        arr[0] = Top10Ranker.cand(live, true, false, 400_000e6, true);
        for (uint256 i; i < n; i++) {
            arr[i + 1] = Top10Ranker.cand(address(uint160(0xB0000 + i)), true, false, 0, false);
            arr[i + 1].tradeCount = i % 3;
            arr[i + 1].lastGoodMarkUsdc = 1_000e6 + (i % 50) * 1e6;
            arr[i + 1].liquidityUsdc = 100e6;
        }
        (address[] memory t, uint256[] memory w, bool pause) = Top10Ranker.rank(arr, 250_000e6);
        assertFalse(pause);
        assertEq(t.length, 1);
        assertEq(t[0], live);
        assertEq(w[0], 10_000);
    }

    function test_43_weightsSum100Percent() public {
        address a = _tok("A");
        address b = _tok("B");
        _fillAndGraduate(alice, a);
        _fillAndGraduate(alice, b);
        Top10Ranker.Candidate[] memory arr = new Top10Ranker.Candidate[](2);
        arr[0] = Top10Ranker.cand(a, true, false, 400_000e6, true);
        arr[1] = Top10Ranker.cand(b, true, false, 100_000e6, true);
        (address[] memory t, uint256[] memory w, bool pause) = Top10Ranker.rank(arr, 250_000e6);
        assertEq(t.length, 1, "B is below $250k floor");
        assertEq(t[0], a);
        assertEq(w[0], 10_000);
        assertFalse(pause);
        uint256 sum;
        for (uint256 i; i < w.length; i++) {
            sum += w[i];
        }
        assertEq(sum, 10_000);
    }

    function test_43_twoAboveFloorWeightByMark() public {
        address a = _tok("AA");
        address b = _tok("BB");
        _fillAndGraduate(alice, a);
        _fillAndGraduate(alice, b);
        Top10Ranker.Candidate[] memory arr = new Top10Ranker.Candidate[](2);
        arr[0] = Top10Ranker.cand(a, true, false, 600_000e6, true);
        arr[1] = Top10Ranker.cand(b, true, false, 400_000e6, true);
        (address[] memory t, uint256[] memory w,) = Top10Ranker.rank(arr, 250_000e6);
        assertEq(t.length, 2);
        uint256 sum = w[0] + w[1];
        assertEq(sum, 10_000);
        assertEq(t[0], a);
        assertGt(w[0], w[1]);
    }

    function test_43_onchainRejectsApiGuessIfUngraduated() public {
        address token = _tok("G");
        (address[] memory t, uint256[] memory w,) =
            Top10Ranker.rank(_one(token, false, false, 400_000e6, true), 250_000e6);
        assertEq(t.length, 0);
        t = new address[](1);
        w = new uint256[](1);
        t[0] = token;
        w[0] = 10_000;
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.submitEpoch(0, t, w);
    }

    function test_43_onchainAcceptsGraduatedWeights() public {
        address token = _tok("OK");
        _fillAndGraduate(alice, token);
        (address[] memory t, uint256[] memory w,) =
            Top10Ranker.rank(_one(token, true, false, 400_000e6, true), 250_000e6);
        vm.prank(keeper);
        flywheel.submitEpoch(0, t, w);
        assertEq(flywheel.ranked(0), token);
        assertEq(flywheel.weights(0), 10_000);
    }

    function _one(address token, bool graduated, bool isCore, uint256 mark, bool ok)
        internal
        pure
        returns (Top10Ranker.Candidate[] memory arr)
    {
        arr = new Top10Ranker.Candidate[](1);
        arr[0] = Top10Ranker.cand(token, graduated, isCore, mark, ok);
    }
}
