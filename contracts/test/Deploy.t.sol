// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// Spec §3.9: after deployment the timelock holds a 24h delay, only the Safe can
/// propose/execute, and the deployer keeps no role anywhere.
contract DeployTest is Test {
    address internal safe = makeAddr("safe");
    address internal keeper = makeAddr("keeper");
    address internal sequencer = makeAddr("sequencer");

    // Both scenarios in one test: vm.setEnv is process-wide and tests run in parallel.
    function test_deploy() public {
        _withoutCrdn();
        _locksGovernance();
    }

    function _locksGovernance() internal {
        vm.setEnv("SAFE", vm.toString(safe));
        vm.setEnv("GUARDIAN", vm.toString(makeAddr("guardian")));
        vm.setEnv("WORKERS", vm.toString(makeAddr("workers")));
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        vm.setEnv("BURN_SINK", vm.toString(makeAddr("burnSink")));
        vm.setEnv("CRDN", vm.toString(makeAddr("crdn")));
        vm.setEnv("KEEPER", vm.toString(keeper));
        vm.setEnv("SEQUENCER", vm.toString(sequencer));
        vm.setEnv("TESTNET_ASSETS", "true");

        vm.warp(1_800_000_000); // at timestamp 1 a 0-delay operation reads as already done
        Deploy.Deployed memory d = new Deploy().run();
        TimelockController tl = TimelockController(payable(d.timelock));
        CordonControl control = CordonControl(d.control);
        (, address deployer,) = vm.readCallers();

        assertEq(tl.getMinDelay(), 24 hours);
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), safe));
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), safe));
        assertFalse(tl.hasRole(tl.PROPOSER_ROLE(), deployer));
        assertFalse(tl.hasRole(tl.EXECUTOR_ROLE(), deployer));
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), deployer));

        assertEq(control.owner(), d.timelock);
        assertEq(AssetGate(d.assetGate).owner(), d.timelock);
        assertTrue(control.isEngine(d.bundler));
        assertTrue(control.isEngine(d.settler));
        assertTrue(control.isEngine(d.encumbrances));
        assertTrue(control.isKeeper(keeper));
        assertEq(control.sequencer(), sequencer);
        assertEq(control.feeRecipient(), d.staking);

        // Testnet faucet assets are registered and priced in the bootstrap batch.
        assertTrue(AssetGate(d.assetGate).isActive(d.testAssets[0]));
        assertEq(AssetGate(d.assetGate).claimMask(d.testAssets[3]), 27, "USDG has no VOTE");
        assertEq(PriceOracle(d.oracle).rawPrice(d.testAssets[0], 1), 250e27 / 1e18, "$250 per share");
        vm.setEnv("TESTNET_ASSETS", "false");
    }

    /// $CRDN not launched: no staking, fees stay in the pool.
    function _withoutCrdn() internal {
        vm.setEnv("SAFE", vm.toString(safe));
        vm.setEnv("GUARDIAN", vm.toString(makeAddr("guardian")));
        vm.setEnv("CRDN", vm.toString(address(0)));
        vm.setEnv("KEEPER", vm.toString(keeper));
        vm.setEnv("SEQUENCER", vm.toString(sequencer));
        vm.warp(1_800_000_000);
        Deploy.Deployed memory d = new Deploy().run();
        assertEq(d.staking, address(0));
        assertEq(CordonControl(d.control).feeRecipient(), address(0));
        vm.expectRevert(CordonPool.NoFeeRecipient.selector);
        CordonPool(d.pool).collectFees(makeAddr("asset"));
    }
}
