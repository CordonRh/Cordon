// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CrdnStaking} from "../src/CrdnStaking.sol";
import {SolvencyVerifier} from "../src/SolvencyVerifier.sol";
import {CordonTest, MockStock} from "./Base.t.sol";

contract SolvencyAndStakingTest is CordonTest {
    SolvencyVerifier internal solvency;
    CrdnStaking internal staking;
    MockStock internal crdn;
    address internal workers = makeAddr("workers");
    address internal treasury = makeAddr("treasury");
    address internal burnSink = makeAddr("burnSink");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        solvency = new SolvencyVerifier(pool);
        crdn = new MockStock();
        staking = new CrdnStaking(crdn, workers, treasury, burnSink, pool);
        vm.prank(gov);
        control.setFeeRecipient(address(staking));
        crdn.mint(alice, 1000);
        crdn.mint(bob, 3000);
        vm.prank(alice);
        crdn.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        crdn.approve(address(staking), type(uint256).max);
    }

    function test_solventHourly() public {
        _depositNote(1000, 1);
        SolvencyVerifier.Record memory r = solvency.attest(address(stock));
        assertEq(r.poolBalance, 1000);
        assertEq(r.liveClaims, 1000);

        vm.expectRevert(SolvencyVerifier.TooEarly.selector);
        solvency.attest(address(stock));
        vm.warp(block.timestamp + 1 hours);
        assertEq(solvency.attest(address(stock)).epoch, 2);
    }

    function test_injectedDeficitFails() public {
        _depositNote(1000, 2);
        vm.prank(address(pool));
        stock.transfer(bob, 1); // tokens leave the pool outside any note operation
        vm.expectRevert(abi.encodeWithSelector(SolvencyVerifier.Deficit.selector, address(stock), 999, 1000));
        solvency.attest(address(stock));
    }

    function test_feesSplit80_10_5_5() public {
        vm.prank(alice);
        staking.stake(1000);
        vm.prank(bob);
        staking.stake(3000);

        stock.mint(address(staking), 10_000); // stands in for pool.collectFees
        staking.distribute(address(stock));
        assertEq(stock.balanceOf(workers), 8000);
        assertEq(stock.balanceOf(treasury), 1000);
        assertEq(stock.balanceOf(burnSink), 500);
        assertEq(staking.claimable(alice, address(stock)), 125);
        assertEq(staking.claimable(bob, address(stock)), 375);

        vm.prank(bob);
        staking.claim(address(stock));
        assertEq(stock.balanceOf(bob), 375);
    }

    function test_collectFeesReachesStaking() public {
        vm.prank(alice);
        staking.stake(1000);
        // A bundle fee credited by an engine, then collected by anyone.
        _depositNote(10_000, 3);
        vm.prank(address(bundler));
        pool.creditFee(address(stock), 100);
        pool.collectFees(address(stock));
        staking.distribute(address(stock));
        assertEq(stock.balanceOf(workers), 80);
        assertEq(stock.balanceOf(treasury), 10);
        assertEq(stock.balanceOf(burnSink), 5);
        assertEq(staking.claimable(alice, address(stock)), 5);
    }

    function test_votersLockedUntilVoteEnds() public {
        vm.prank(alice);
        staking.stake(1000);
        vm.prank(alice);
        uint256 id = staking.propose(CrdnStaking.Subject.TEMPLATE, keccak256("allow LIEN on TREASURY"));
        vm.prank(alice);
        staking.vote(id, true);

        vm.prank(alice);
        vm.expectRevert(CrdnStaking.Locked.selector);
        staking.unstake(1000);

        vm.warp(block.timestamp + staking.MIN_STAKE_PERIOD());
        vm.prank(alice);
        staking.unstake(1000);
        (,,, uint256 forVotes,) = staking.proposals(id);
        assertEq(forVotes, 1000);
    }

    function test_onlyListedAssetsAreFeeTokens() public {
        MockStock junk = new MockStock();
        vm.expectRevert(abi.encodeWithSelector(CrdnStaking.NotFeeToken.selector, address(junk)));
        staking.distribute(address(junk));
        vm.expectRevert(abi.encodeWithSelector(CrdnStaking.NotFeeToken.selector, address(crdn)));
        staking.distribute(address(crdn));
        assertEq(staking.claimable(alice, address(junk)), 0);
    }

    /// Stake, collect, distribute, claim, unstake in one go no longer works: the stake
    /// stays MIN_STAKE_PERIOD, so a snipe carries a week of exposure.
    function test_justInTimeStakeCannotLeave() public {
        vm.prank(alice);
        staking.stake(1000);
        vm.warp(block.timestamp + staking.MIN_STAKE_PERIOD());
        stock.mint(address(staking), 10_000);

        vm.startPrank(bob);
        staking.stake(3000); // sweeps first: the fees already here go to alice
        staking.distribute(address(stock));
        assertEq(staking.claimable(bob, address(stock)), 0, "a new stake shares no earlier fees");
        assertEq(staking.claimable(alice, address(stock)), 500);
        vm.expectRevert(CrdnStaking.Locked.selector);
        staking.unstake(3000);
        vm.stopPrank();
    }

    function testFuzz_stakingConservesFees(uint96 a, uint96 b, uint96 fee) public {
        vm.assume(a > 0 && b > 0);
        crdn.mint(alice, a);
        crdn.mint(bob, b);
        vm.prank(alice);
        staking.stake(a);
        vm.prank(bob);
        staking.stake(b);
        stock.mint(address(staking), fee);
        staking.distribute(address(stock));
        uint256 owedAll = staking.claimable(alice, address(stock)) + staking.claimable(bob, address(stock));
        uint256 out = stock.balanceOf(workers) + stock.balanceOf(treasury) + stock.balanceOf(burnSink);
        // The four parts sum to the fee exactly; stakers' claims stay within their 5% and
        // lose at most rounding dust.
        assertEq(out + staking.booked(address(stock)), uint256(fee));
        assertEq(stock.balanceOf(treasury), uint256(fee) * 1000 / 10_000);
        assertEq(stock.balanceOf(burnSink), uint256(fee) * 500 / 10_000);
        assertEq(staking.booked(address(stock)), uint256(fee) * 500 / 10_000);
        assertLe(owedAll + out, uint256(fee));
        assertGe(owedAll + out + 2, uint256(fee));
    }
}
