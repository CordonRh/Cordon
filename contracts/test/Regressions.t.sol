// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BundleHelpers} from "./BundleVerifier.t.sol";
import {BundleVerifier} from "../src/BundleVerifier.sol";
import {CrdnStaking} from "../src/CrdnStaking.sol";
import {MockStock} from "./Base.t.sol";

/// Regressions from the 2026-10-05 security review.
contract RegressionsTest is BundleHelpers {
    /// live-index-binding: an unbundle proof made at T still settles after a later checkpoint.
    function test_unbundleSurvivesLaterCheckpoint() public {
        Bundled memory b = _bundle(_depositNote(R, 91), 31);
        vm.warp(block.timestamp + 10);
        (, uint256 j) = actions.latest(address(stock));
        uint256 outRaw = b.raw * j / b.j;
        (bytes memory proof, bytes32[] memory pub) = _prove("unbundle", _unbundleToml(b.claims, 31, outRaw));
        vm.warp(block.timestamp + 10 minutes);
        stock.setMultiplier(1.01e18);
        actions.sync(address(stock));
        assertGt(actions.checkpointCount(address(stock)), 1);
        uint256[5] memory nullifiers;
        for (uint256 k; k < 5; ++k) nullifiers[k] = _u(pub[6 + k]);
        bundler.unbundle(proof, BundleVerifier.Unbundle(_u(pub[0]), _u(pub[1]), address(stock), nullifiers, _u(pub[11])));
    }

    function _staking() internal returns (CrdnStaking staking, MockStock crdn, address workers) {
        crdn = new MockStock();
        workers = makeAddr("workers");
        staking = new CrdnStaking(crdn, workers, makeAddr("treasury"), makeAddr("burnSink"), pool);
        vm.prank(gov);
        control.setFeeRecipient(address(staking));
    }

    function _stake(CrdnStaking staking, MockStock crdn, address who, uint256 amount) internal {
        crdn.mint(who, amount);
        vm.startPrank(who);
        crdn.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    /// jit-reward-capture: fees still sitting in the pool go to the existing stakers before
    /// a new stake is credited.
    function test_stakeSweepsPoolFeesFirst() public {
        (CrdnStaking staking, MockStock crdn,) = _staking();
        _stake(staking, crdn, alice, 1000);
        _depositNote(10_000, 92);
        vm.prank(address(bundler));
        pool.creditFee(address(stock), 10_000);
        _stake(staking, crdn, bob, 1_000_000);
        assertEq(staking.claimable(bob, address(stock)), 0, "bob shares none");
        assertEq(staking.claimable(alice, address(stock)), 500);
    }

    /// idle-fees-first-staker: the stakers' share of fees that arrive while nobody is staked
    /// goes to workers, not to the first (1 wei) staker.
    function test_idleFeesGoToWorkers() public {
        (CrdnStaking staking, MockStock crdn, address workers) = _staking();
        _depositNote(10_000, 93);
        vm.prank(address(bundler));
        pool.creditFee(address(stock), 10_000);
        pool.collectFees(address(stock));
        _stake(staking, crdn, bob, 1);
        staking.distribute(address(stock));
        assertEq(staking.claimable(bob, address(stock)), 0, "1 wei captures nothing");
        assertEq(stock.balanceOf(workers), 8500, "workers' 80% plus the idle stakers' 5%");
    }
}
