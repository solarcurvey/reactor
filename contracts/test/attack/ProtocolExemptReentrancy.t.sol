// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../Base.sol";
import {ReactorFactory} from "../../src/ReactorFactory.sol";
import {ReactorRouter} from "../../src/ReactorRouter.sol";
import {QuoteAssetRegistry} from "../../src/QuoteAssetRegistry.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

/// @notice Named Codex audit target: malicious ERC-20 callback must not ride protocolExempt
///         to execute a fee-free user `swap`.
contract MaliciousExemptToken {
    string public name = "Malicious Quote";
    string public symbol = "MALQ";
    uint8 public immutable decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    ReactorRouter public victimRouter;
    PoolKey public victimKey;
    bool public sneakTried;
    bool public sneakSucceeded;
    uint256 public sneakOut;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setAttack(ReactorRouter r, PoolKey memory key) external {
        victimRouter = r;
        victimKey = key;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ALLOWANCE");
            allowance[from][msg.sender] = allowed - amount;
        }
        if (address(victimRouter) != address(0) && victimRouter.protocolExempt() == 1) {
            sneakTried = true;
            try victimRouter.swap(victimKey, true, -int256(1e6), 1, address(this)) returns (uint256 got) {
                sneakSucceeded = true;
                sneakOut = got;
            } catch {}
            try victimRouter.protocolSwap(victimKey, true, -int256(1e6), 1, address(this)) returns (uint256) {
                sneakSucceeded = true;
            } catch {}
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BAL");
        unchecked {
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
        }
    }
}

contract ProtocolExemptReentrancyTest is Base {
    MaliciousExemptToken internal mal;

    function setUp() public override {
        super.setUp();
        mal = new MaliciousExemptToken();
        mal.mint(alice, 10_000_000e6);
        mal.mint(address(this), 10_000_000e6);
        registry.register(address(mal), "MALQ", "Malicious Quote", 6, "", QuoteAssetRegistry.Category.Crypto);
        registry.setBuybackRoute(address(mal), true, true);
        registry.setUsdPegOne(address(mal), true);
    }

    function test_maliciousCallbackCannotFeeExemptUserTrade() public {
        ReactorFactory.InstantParams memory p = ReactorFactory.InstantParams({
            name: "V",
            symbol: "V",
            decimals: 18,
            supply: 0,
            quote: address(mal),
            fdvQuoteRaw: 0,
            devBuyQuote: 0,
            image: "",
            description: "",
            website: "",
            twitter: "",
            telegram: ""
        });
        (address token,) = factory.launchStandard(p);
        vm.startPrank(alice);
        mal.approve(address(curve), type(uint256).max);
        curve.buy(token, 80_000e6, 1);
        vm.stopPrank();
        if (!curve.graduatedOf(token)) {
            vm.prank(keeper);
            curve.graduate(token);
        }
        assertTrue(curve.graduatedOf(token));

        uint256 acc = selfBurn.accrued(token);
        if (acc < 10_000) {
            vm.prank(address(hook));
            selfBurn.accrue(token, address(mal), 50_000e6);
            mal.mint(address(selfBurn), 50_000e6);
        }

        mal.setAttack(router, officialCoreKey());
        vm.prank(keeper);
        uint256 burned = selfBurn.execute(token, 1);
        assertGt(burned, 0);
        assertTrue(mal.sneakTried(), "callback must observe the exempt window");
        assertFalse(mal.sneakSucceeded(), "reentrant user/protocol swap must be blocked");
        assertEq(mal.sneakOut(), 0);
        assertEq(router.protocolExempt(), 0);
    }

    function test_userSwapWhileExemptFlagSetRevertsDirectly() public {
        // Isolated: if a caller already holds the latch, swap refuses even without the lock.
        // The public path cannot set the latch; this documents WalletExemptForbidden on swap.
        (address token,) = factory.instantLaunch(
            ReactorFactory.InstantParams({
                name: "N",
                symbol: "N",
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
        _fillAndGraduate(alice, token);
        assertEq(router.protocolExempt(), 0);
        usdc.approve(address(router), 10e6);
        uint256 out = router.swap(_key(token, address(usdc)), address(usdc) < token, -int256(10e6), 1, address(this));
        assertGt(out, 0);
    }
}
