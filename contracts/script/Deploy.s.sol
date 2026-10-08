// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {BundleVerifier} from "../src/BundleVerifier.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {CrdnStaking} from "../src/CrdnStaking.sol";
import {DvPSettler} from "../src/DvPSettler.sol";
import {EncumbranceRegistry} from "../src/EncumbranceRegistry.sol";
import {NavAttestor} from "../src/NavAttestor.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {SolvencyVerifier} from "../src/SolvencyVerifier.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {TransferHonkVerifier} from "../src/verifiers/TransferHonkVerifier.sol";
import {BundleHonkVerifier} from "../src/verifiers/BundleHonkVerifier.sol";
import {UnbundleHonkVerifier} from "../src/verifiers/UnbundleHonkVerifier.sol";
import {TermHonkVerifier} from "../src/verifiers/TermHonkVerifier.sol";
import {IncomeHonkVerifier} from "../src/verifiers/IncomeHonkVerifier.sol";
import {DvpHonkVerifier} from "../src/verifiers/DvpHonkVerifier.sol";
import {OrderHonkVerifier} from "../src/verifiers/OrderHonkVerifier.sol";
import {EncumberHonkVerifier} from "../src/verifiers/EncumberHonkVerifier.sol";
import {UnlockHonkVerifier} from "../src/verifiers/UnlockHonkVerifier.sol";
import {EnforceHonkVerifier} from "../src/verifiers/EnforceHonkVerifier.sol";
import {NavHonkVerifier} from "../src/verifiers/NavHonkVerifier.sol";

/// Spec §3.9. Env: SAFE (2-of-3 multisig), GUARDIAN, KEEPER, SEQUENCER, optional CRDN; with
/// CRDN also the fee recipients WORKERS (80%), TREASURY (10%) and BURN_SINK (5%, buys back
/// and burns CRDN). Without CRDN ($CRDN not launched) no staking is deployed and fees accrue
/// in the pool until a Safe proposal deploys CrdnStaking and sets it as CordonControl.feeRecipient.
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL_4663 --broadcast --private-key $FRESH_DEPLOYER_KEY
/// Writes the addresses to ../packages/shared/deployments/<chainid>.json.
contract Deploy is Script {
    uint256 internal constant DELAY = 24 hours;
    address internal constant CANONICAL_POSEIDON2 = 0xB2542195Ad96AcfBC962C48A97D7640A9F5386D2;

    struct Deployed {
        address hasher;
        address timelock;
        address control;
        address assetGate;
        address screening;
        address pool;
        address actions;
        address bundler;
        address oracle;
        address settler;
        address encumbrances;
        address nav;
        address solvency;
        address staking;
    }

    function run() external returns (Deployed memory d) {
        address safe = vm.envAddress("SAFE");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers(); // the broadcaster, in scripts and in tests
        // Bootstrap timelock: delay 0 with the deployer as proposer/executor/admin,
        // only until the wiring below is done.
        address[] memory boot = new address[](2);
        boot[0] = deployer;
        boot[1] = safe;
        d.timelock = address(new TimelockController(0, boot, boot, deployer));
        _deploy(d);
        _wireAndLock(d, deployer);
        vm.stopBroadcast();
        _write(d);
    }

    function _deploy(Deployed memory d) internal {
        d.hasher = CANONICAL_POSEIDON2.code.length != 0 ? CANONICAL_POSEIDON2 : address(new Poseidon2Yul_BN254());
        CordonControl control = new CordonControl(d.timelock, vm.envAddress("GUARDIAN"), address(0));
        AssetGate gate = new AssetGate(d.timelock);
        ScreeningGate screening = new ScreeningGate(control);
        CordonPool pool = new CordonPool(IPoseidon2(d.hasher), gate, control, screening, _v(address(new TransferHonkVerifier())));
        ActionEngine actions = new ActionEngine(gate, control);
        d.control = address(control);
        d.assetGate = address(gate);
        d.screening = address(screening);
        d.pool = address(pool);
        d.actions = address(actions);
        d.bundler = address(
            new BundleVerifier(
                pool, actions, _v(address(new BundleHonkVerifier())), _v(address(new UnbundleHonkVerifier())), _v(address(new TermHonkVerifier())), _v(address(new IncomeHonkVerifier()))
            )
        );
        PriceOracle oracle = new PriceOracle(d.timelock, gate);
        d.oracle = address(oracle);
        d.settler = address(new DvPSettler(pool, oracle, _v(address(new DvpHonkVerifier())), _v(address(new OrderHonkVerifier()))));
        d.encumbrances =
            address(new EncumbranceRegistry(pool, _v(address(new EncumberHonkVerifier())), _v(address(new UnlockHonkVerifier())), _v(address(new EnforceHonkVerifier()))));
        d.nav = address(new NavAttestor(d.timelock, pool, oracle, _v(address(new NavHonkVerifier()))));
        d.solvency = address(new SolvencyVerifier(pool));
        address crdn = vm.envOr("CRDN", address(0));
        if (crdn != address(0)) {
            d.staking = address(
                new CrdnStaking(
                    IERC20(crdn), vm.envAddress("WORKERS"), vm.envAddress("TREASURY"), vm.envAddress("BURN_SINK"), pool
                )
            );
        }
    }

    /// Wiring through the timelock, then lock it: 24h delay and Safe-only roles.
    function _wireAndLock(Deployed memory d, address deployer) internal {
        TimelockController timelock = TimelockController(payable(d.timelock));
        uint256 n = 7;
        address[] memory targets = new address[](n);
        bytes[] memory calls = new bytes[](n);
        (targets[0], calls[0]) = (d.control, abi.encodeCall(CordonControl.setEngine, (d.bundler, true)));
        (targets[1], calls[1]) = (d.control, abi.encodeCall(CordonControl.setEngine, (d.settler, true)));
        (targets[2], calls[2]) = (d.control, abi.encodeCall(CordonControl.setEngine, (d.encumbrances, true)));
        (targets[3], calls[3]) =
            (d.control, abi.encodeCall(CordonControl.setKeeper, (vm.envAddress("KEEPER"), true)));
        (targets[4], calls[4]) =
            (d.control, abi.encodeCall(CordonControl.setSequencer, (vm.envAddress("SEQUENCER"))));
        (targets[5], calls[5]) = (d.control, abi.encodeCall(CordonControl.setFeeRecipient, (d.staking)));
        // Last: lock the timelock.
        (targets[n - 1], calls[n - 1]) = (d.timelock, abi.encodeCall(TimelockController.updateDelay, (DELAY)));
        uint256[] memory values = new uint256[](n);
        timelock.scheduleBatch(targets, values, calls, bytes32(0), bytes32(0), 0);
        timelock.executeBatch(targets, values, calls, bytes32(0), bytes32(0));

        timelock.revokeRole(timelock.PROPOSER_ROLE(), deployer);
        timelock.revokeRole(timelock.EXECUTOR_ROLE(), deployer);
        timelock.revokeRole(timelock.CANCELLER_ROLE(), deployer);
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), deployer);
    }

    function _v(address a) internal pure returns (IProofVerifier) {
        return IProofVerifier(a);
    }

    /// On Arbitrum chains (Robinhood Chain) block.number and vm.getBlockNumber() report the
    /// parent-chain block, so ask the RPC for the L2 head. It is read before the broadcast
    /// lands: a lower bound of the deploy block, which is all the indexers need.
    function _l2Block() internal returns (uint256) {
        try vm.rpc("eth_blockNumber", "[]") returns (bytes memory r) {
            return uint256(bytes32(r)) >> (256 - 8 * r.length);
        } catch {
            return vm.getBlockNumber(); // no RPC (unit tests)
        }
    }

    function _write(Deployed memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", _l2Block());
        vm.serializeAddress(k, "poseidon2", d.hasher);
        // Expected roles, for script/PostDeployCheck.s.sol.
        vm.serializeAddress(k, "safe", vm.envAddress("SAFE"));
        vm.serializeAddress(k, "guardian", vm.envAddress("GUARDIAN"));
        vm.serializeAddress(k, "keeper", vm.envAddress("KEEPER"));
        vm.serializeAddress(k, "sequencer", vm.envAddress("SEQUENCER"));
        (, address deployer,) = vm.readCallers();
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeUint(k, "minDelay", 24 hours);
        vm.serializeAddress(k, "timelock", d.timelock);
        vm.serializeAddress(k, "control", d.control);
        vm.serializeAddress(k, "assetGate", d.assetGate);
        vm.serializeAddress(k, "screeningGate", d.screening);
        vm.serializeAddress(k, "pool", d.pool);
        vm.serializeAddress(k, "actionEngine", d.actions);
        vm.serializeAddress(k, "bundleVerifier", d.bundler);
        vm.serializeAddress(k, "priceOracle", d.oracle);
        vm.serializeAddress(k, "dvpSettler", d.settler);
        vm.serializeAddress(k, "encumbranceRegistry", d.encumbrances);
        vm.serializeAddress(k, "navAttestor", d.nav);
        vm.serializeAddress(k, "solvencyVerifier", d.solvency);
        string memory json = vm.serializeAddress(k, "crdnStaking", d.staking);
        string memory path = string.concat("../packages/shared/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("addresses written to", path);
    }
}
