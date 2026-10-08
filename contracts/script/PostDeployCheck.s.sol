// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {BundleVerifier} from "../src/BundleVerifier.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {DvPSettler} from "../src/DvPSettler.sol";
import {EncumbranceRegistry} from "../src/EncumbranceRegistry.sol";
import {NavAttestor} from "../src/NavAttestor.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {SolvencyVerifier} from "../src/SolvencyVerifier.sol";

interface ITimelock {
    function getMinDelay() external view returns (uint256);
    function hasRole(bytes32 role, address account) external view returns (bool);
    function PROPOSER_ROLE() external view returns (bytes32);
    function EXECUTOR_ROLE() external view returns (bytes32);
    function CANCELLER_ROLE() external view returns (bytes32);
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);
}

interface IOwnable2Step {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}

/// Read-only check of a live deployment against packages/shared/deployments/<chainId>.json
/// (written by Deploy.s.sol). Never broadcasts; any mismatch fails the run and names it.
///   forge script script/PostDeployCheck.s.sol --rpc-url $RPC_URL
/// Bytecode: also run `forge verify-bytecode <address> <Contract> --rpc-url ...` (or
/// scripts/verify-bytecode in CI) for every address; this script checks wiring and roles.
contract PostDeployCheck is Script {
    string internal json;
    uint256 internal failures;

    function run() external {
        json = vm.readFile(
            string.concat(vm.projectRoot(), "/../packages/shared/deployments/", vm.toString(block.chainid), ".json")
        );
        _code();
        _governance();
        _roles();
        _wiring();
        _feeds();
        if (failures != 0) revert(string.concat(vm.toString(failures), " post-deploy check(s) failed"));
        console2.log("post-deploy check passed on chain", block.chainid);
    }

    /// Code exists at every address in the manifest.
    function _code() internal {
        string[12] memory keys = [
            ".timelock", ".control", ".assetGate", ".priceOracle", ".navAttestor", ".pool", ".bundleVerifier",
            ".dvpSettler", ".encumbranceRegistry", ".actionEngine", ".solvencyVerifier", ".screeningGate"
        ];
        for (uint256 i; i < keys.length; ++i) {
            _check(_a(keys[i]).code.length > 0, string.concat("code at ", keys[i]));
        }
    }

    /// The timelock owns everything, with the declared delay, and only the Safe acts.
    function _governance() internal {
        ITimelock tl = ITimelock(_a(".timelock"));
        address safe = _a(".safe");
        address deployer = _a(".deployer");
        _check(tl.getMinDelay() == vm.parseJsonUint(json, ".minDelay"), "timelock delay");
        _check(tl.hasRole(tl.PROPOSER_ROLE(), safe), "safe proposes");
        _check(tl.hasRole(tl.EXECUTOR_ROLE(), safe), "safe executes");
        _check(!tl.hasRole(tl.PROPOSER_ROLE(), deployer), "deployer cannot propose");
        _check(!tl.hasRole(tl.EXECUTOR_ROLE(), deployer), "deployer cannot execute");
        _check(!tl.hasRole(tl.CANCELLER_ROLE(), deployer), "deployer cannot cancel");
        _check(!tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), deployer), "deployer is not timelock admin");
        _check(!tl.hasRole(tl.EXECUTOR_ROLE(), address(0)), "execution is not open to anyone");
        string[4] memory owned = [".control", ".assetGate", ".priceOracle", ".navAttestor"];
        for (uint256 i; i < owned.length; ++i) {
            _check(IOwnable2Step(_a(owned[i])).owner() == address(tl), string.concat("timelock owns ", owned[i]));
            _check(IOwnable2Step(_a(owned[i])).pendingOwner() == address(0), string.concat("no pending owner ", owned[i]));
        }
    }

    /// Roles and engines: exactly the three engines that verify proofs.
    function _roles() internal {
        CordonControl control = CordonControl(_a(".control"));
        address deployer = _a(".deployer");
        _check(control.guardian() == _a(".guardian"), "guardian");
        _check(control.isKeeper(_a(".keeper")), "keeper");
        _check(!control.isKeeper(deployer), "deployer is not a keeper");
        _check(control.sequencer() == _a(".sequencer"), "sequencer");
        _check(control.paused() == 0, "nothing paused");
        _check(control.feeRecipient() == _a(".crdnStaking"), "fee recipient");
        _check(control.isEngine(_a(".bundleVerifier")), "bundler is an engine");
        _check(control.isEngine(_a(".dvpSettler")), "settler is an engine");
        _check(control.isEngine(_a(".encumbranceRegistry")), "encumbrance registry is an engine");
        _check(
            !control.isEngine(deployer) && !control.isEngine(_a(".safe")) && !control.isEngine(_a(".timelock")),
            "no EOA or timelock engine"
        );
    }

    /// Every contract points at the manifest's pool, gate, oracle and engine.
    function _wiring() internal {
        CordonPool pool = CordonPool(_a(".pool"));
        _check(address(pool.control()) == _a(".control") && address(pool.assetGate()) == _a(".assetGate"), "pool wiring");
        _check(pool.DEPTH() == 32, "tree depth 32");
        BundleVerifier bundler = BundleVerifier(_a(".bundleVerifier"));
        _check(address(bundler.pool()) == address(pool) && address(bundler.actions()) == _a(".actionEngine"), "bundler wiring");
        DvPSettler settler = DvPSettler(_a(".dvpSettler"));
        _check(address(settler.pool()) == address(pool) && address(settler.oracle()) == _a(".priceOracle"), "settler wiring");
        _check(address(settler.verifier()).code.length > 0 && address(settler.orderVerifier()).code.length > 0, "settler verifiers");
        _check(address(EncumbranceRegistry(_a(".encumbranceRegistry")).pool()) == address(pool), "registry wiring");
        NavAttestor nav = NavAttestor(_a(".navAttestor"));
        _check(address(nav.pool()) == address(pool) && address(nav.oracle()) == _a(".priceOracle"), "nav wiring");
        _check(address(ActionEngine(_a(".actionEngine")).assetGate()) == _a(".assetGate"), "engine gate wiring");
        _check(address(PriceOracle(_a(".priceOracle")).assetGate()) == _a(".assetGate"), "oracle gate wiring");
        _check(address(SolvencyVerifier(_a(".solvencyVerifier")).pool()) == address(pool), "solvency wiring");
    }

    /// Every listed asset has a feed with a heartbeat of at most a day.
    function _feeds() internal {
        AssetGate gate = AssetGate(_a(".assetGate"));
        PriceOracle oracle = PriceOracle(_a(".priceOracle"));
        uint256 n = gate.assetCount();
        for (uint256 i; i < n; ++i) {
            (, uint32 heartbeat) = oracle.feeds(gate.assetList(i));
            _check(heartbeat > 0 && heartbeat <= 1 days, "asset feed heartbeat");
        }
    }

    function _a(string memory key) internal view returns (address) {
        return vm.parseJsonAddress(json, key);
    }

    function _check(bool ok, string memory what) internal {
        if (!ok) {
            ++failures;
            console2.log("FAIL:", what);
        }
    }
}
