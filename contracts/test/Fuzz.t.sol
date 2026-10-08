// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CordonPool} from "../src/CordonPool.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {CordonTest} from "./Base.t.sol";
import {MockFeed} from "./DvPSettler.t.sol";

/// Stateless fuzz tests on the pool's entry points and the oracle's price math.
contract FuzzTest is CordonTest {
    address internal engine = makeAddr("engine");

    function setUp() public override {
        super.setUp();
        vm.prank(gov);
        control.setEngine(engine, true);
    }

    /// Any accepted deposit is owed in full; the depositor can always take it back exactly.
    function testFuzz_depositAndUnshieldConserve(uint256 raw, uint256 npk) public {
        raw = bound(raw, 1, 1_000_000e18);
        npk = bound(npk, 0, 2 ** 253);
        uint256 start = stock.balanceOf(alice);
        vm.startPrank(alice);
        uint256 id = pool.deposit(address(stock), raw, npk);
        assertEq(pool.owed(address(stock)), raw);
        assertEq(stock.balanceOf(address(pool)), raw);
        pool.unshieldToOrigin(id);
        vm.stopPrank();
        assertEq(pool.owed(address(stock)), 0);
        assertEq(stock.balanceOf(alice), start);
    }

    /// Out-of-range amounts never enter the pool.
    function testFuzz_depositRejectsBadAmounts(uint256 raw) public {
        vm.assume(raw == 0 || raw >= 2 ** 120);
        vm.prank(alice);
        vm.expectRevert(CordonPool.BadAmount.selector);
        pool.deposit(address(stock), raw, 1);
    }

    /// Fees moved out of `owed` keep the books exact: owed + fees == balance, before and
    /// after collection.
    function testFuzz_feesConserveBalance(uint256 raw, uint256 fee) public {
        raw = bound(raw, 1, 1_000_000e18);
        fee = bound(fee, 0, raw);
        _depositNote(raw, 7);
        vm.prank(engine);
        pool.creditFee(address(stock), fee);
        assertEq(pool.owed(address(stock)) + pool.fees(address(stock)), stock.balanceOf(address(pool)));
        pool.collectFees(address(stock));
        assertEq(stock.balanceOf(feeSink), fee);
        assertEq(pool.owed(address(stock)), stock.balanceOf(address(pool)));
    }

    /// An engine can never move more into fees than is owed.
    function testFuzz_creditFeeCannotExceedOwed(uint256 raw, uint256 extra) public {
        raw = bound(raw, 1, 1_000_000e18);
        extra = bound(extra, 1, type(uint128).max);
        _depositNote(raw, 8);
        vm.prank(engine);
        vm.expectRevert();
        pool.creditFee(address(stock), raw + extra);
    }

    /// Price of one raw unit (1e27 = 1 USD): feed answer (8 decimals) x ERC-8056 multiplier,
    /// per 18-decimal raw unit, and monotonic in both inputs.
    function testFuzz_rawPriceMath(uint256 answer, uint256 m) public {
        answer = bound(answer, 1, 1e14); // up to $1,000,000 per share
        m = bound(m, 1e16, 100e18); // 0.01x .. 100x
        PriceOracle oracle = new PriceOracle(gov, gate);
        MockFeed feed = new MockFeed();
        vm.prank(gov);
        oracle.setFeed(address(stock), feed, 1 days);
        stock.setMultiplier(m);
        feed.set(int256(answer));
        uint256 p = oracle.rawPrice(address(stock), 1);
        assertEq(p, answer * 1e27 / 1e8 * m / 1e18 / 1e18);
        stock.setMultiplier(m + 1e16);
        assertGe(oracle.rawPrice(address(stock), 1), p);
    }
}
