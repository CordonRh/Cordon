// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {PerShareFeed} from "../src/PerShareFeed.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {IERC8056} from "../src/interfaces/IERC8056.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

/// A Stock Token with a settable ERC-8056 multiplier.
contract MultiplierToken is ERC20 {
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;

    constructor() ERC20("Stock", "STK") {}

    function set(uint256 m, uint256 next, uint256 at) external {
        (uiMultiplier, newUIMultiplier, effectiveAt) = (m, next, at);
    }
}

/// A Chainlink-style feed with one round.
contract OneRoundFeed is AggregatorV3Interface {
    uint80 public constant ID = 7;
    int256 public answer;
    uint256 public updatedAt;

    function set(int256 a, uint256 at) external {
        (answer, updatedAt) = (a, at);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (ID, answer, updatedAt, updatedAt, ID);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        if (id != ID) revert("no round");
        return (ID, answer, updatedAt, updatedAt, ID);
    }
}

contract PerShareFeedTest is Test {
    MultiplierToken internal token = new MultiplierToken();
    OneRoundFeed internal feed = new OneRoundFeed();
    PerShareFeed internal adapter = new PerShareFeed(feed, IERC8056(address(token)));
    AssetGate internal gate = new AssetGate(address(this));
    PriceOracle internal oracle = new PriceOracle(address(this), gate);

    function setUp() public {
        vm.warp(1_800_000_000);
        gate.register(address(token), AssetGate.Class.STOCK8056, gate.ALL_CLAIMS(), gate.ALL_TEMPLATES());
        oracle.setFeed(address(token), adapter, 1 days);
        feed.set(372.529e8, block.timestamp - 1 hours); // a total-return answer, multiplier included
    }

    /// The oracle prices one raw unit at the feed's per-token answer, whatever the multiplier.
    function testFuzz_oraclePriceIsTheFeedAnswer(uint256 m, int256 answer) public {
        m = bound(m, 1e17, 1e20);
        answer = int256(bound(uint256(answer), 1e6, 1e14)); // $0.01 to $1M
        token.set(m, m, 0);
        feed.set(answer, block.timestamp - 1 hours);
        uint256 expected = uint256(answer) * 1e19 / 1e18; // 1e27 scale, 8-decimal answer, 18-decimal token
        // The adapter's floor loses under one multiplier unit of answer x 1e18: m / 1e17 at 1e27 scale.
        assertApproxEqAbs(oracle.rawPrice(address(token), feed.ID()), expected, m / 1e17 + 2);
    }

    function test_realMultiplier_noDoubleCount() public {
        token.set(1.007187e18, 1.007187e18, 0); // SGOV on 2026-10-08
        assertApproxEqAbs(oracle.rawPrice(address(token), feed.ID()), 372.529e8 * uint256(10), 100);
        // Without the adapter the oracle would multiply the multiplier in twice.
        oracle.setFeed(address(token), feed, 1 days);
        assertApproxEqRel(oracle.rawPrice(address(token), feed.ID()), 372.529e8 * uint256(10) * 1.007187e18 / 1e18, 1e6);
    }

    /// A scheduled multiplier is divided out from its effective time, like the oracle applies it.
    function test_pendingMultiplier_followsEffectiveTime() public {
        token.set(1e18, 2e18, block.timestamp + 1 hours);
        (, int256 before,,,) = adapter.latestRoundData();
        assertEq(before, 372.529e8);
        vm.warp(block.timestamp + 1 hours);
        (, int256 afterSplit,,,) = adapter.latestRoundData();
        assertEq(afterSplit, 372.529e8 / 2);
    }

    function test_passesRoundsThrough() public view {
        (uint80 id,, uint256 startedAt, uint256 updatedAt, uint80 answeredIn) = adapter.getRoundData(feed.ID());
        (uint80 fid,, uint256 fs, uint256 fu, uint80 fa) = feed.getRoundData(feed.ID());
        assertEq(id, fid);
        assertEq(startedAt, fs);
        assertEq(updatedAt, fu);
        assertEq(answeredIn, fa);
        assertEq(adapter.decimals(), 8);
        assertEq(address(adapter.feed()), address(feed));
        assertEq(address(adapter.token()), address(token));
    }

    function test_unknownRound_reverts() public {
        vm.expectRevert(bytes("no round"));
        adapter.getRoundData(8);
    }

    function test_zeroMultiplier_failsClosed() public {
        token.set(0, 0, 0);
        vm.expectRevert();
        adapter.latestRoundData();
        assertFalse(oracle.ok(address(token), feed.ID()));
    }
}
