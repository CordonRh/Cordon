// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {BundleVerifier} from "../src/BundleVerifier.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";

/// Robinhood-style Stock Token: non-rebasing ERC-20 with an ERC-8056 multiplier.
contract MockStock is ERC20 {
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;

    constructor() ERC20("Mock NVDA", "NVDA") {}

    function mint(address to, uint256 raw) external {
        _mint(to, raw);
    }

    function setMultiplier(uint256 m) external {
        uiMultiplier = m;
        newUIMultiplier = m;
        effectiveAt = block.timestamp;
    }
}

/// Deploys the protocol and drives the Noir prover through vm.ffi.
abstract contract CordonTest is Test {
    uint256 internal constant DEPTH = 32;
    uint256 internal constant UNDERLYING = 0;
    uint256 internal constant PRINCIPAL = 1;
    uint256 internal constant INCOME = 2;

    struct Note {
        uint256 asset;
        uint256 raw;
        uint256 kind;
        uint256 bundleId;
        uint256 jBundle;
        uint256 termFrom;
        uint256 termUntil;
        uint256 accruedTo;
        uint256 lock;
        uint256 ownerPk;
        uint256 blinding;
    }

    IPoseidon2 internal hasher;
    CordonControl internal control;
    AssetGate internal gate;
    ScreeningGate internal screening;
    CordonPool internal pool;
    ActionEngine internal actions;
    BundleVerifier internal bundler;
    MockStock internal stock;

    address internal gov = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal feeSink = makeAddr("staking");
    address internal alice = makeAddr("alice");

    uint256 internal sk = 0x1234567;
    uint256 internal ownerPk;
    uint256[] internal leaves;
    uint256[DEPTH] internal zeros;
    uint256 private nonce;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        hasher = IPoseidon2(address(new Poseidon2Yul_BN254()));
        control = new CordonControl(gov, guardian, feeSink);
        gate = new AssetGate(gov);
        screening = new ScreeningGate(control);
        pool = new CordonPool(hasher, gate, control, screening, _verifier("Transfer"));
        actions = new ActionEngine(gate, control);
        bundler = new BundleVerifier(
            pool, actions, _verifier("Bundle"), _verifier("Unbundle"), _verifier("Term"), _verifier("Income")
        );
        stock = new MockStock();

        vm.startPrank(gov);
        control.setEngine(address(bundler), true);
        control.setKeeper(keeper, true);
        gate.register(address(stock), AssetGate.Class.STOCK8056, gate.ALL_CLAIMS(), gate.ALL_TEMPLATES());
        vm.stopPrank();
        actions.sync(address(stock));

        ownerPk = hasher.hash_1(sk);
        uint256 z;
        for (uint256 i; i < DEPTH; ++i) {
            zeros[i] = z;
            z = hasher.hash_2(z, z);
        }
        stock.mint(alice, 1_000_000e18);
        vm.prank(alice);
        stock.approve(address(pool), type(uint256).max);
    }

    function _verifier(string memory name) internal returns (IProofVerifier) {
        string memory c = string.concat(name, "HonkVerifier");
        return IProofVerifier(deployCode(string.concat(c, ".sol:", c)));
    }

    // ------------------------------------------------------------ notes

    function _note(uint256 raw, uint256 blinding) internal view returns (Note memory n) {
        n.asset = uint160(address(stock));
        n.raw = raw;
        n.ownerPk = ownerPk;
        n.blinding = blinding;
    }

    /// Memory structs alias on assignment; copy before editing a note.
    function _copy(Note memory n) internal pure returns (Note memory) {
        return Note(
            n.asset,
            n.raw,
            n.kind,
            n.bundleId,
            n.jBundle,
            n.termFrom,
            n.termUntil,
            n.accruedTo,
            n.lock,
            n.ownerPk,
            n.blinding
        );
    }

    function commitOf(Note memory n) internal view returns (uint256) {
        return hasher.hash_3(
            hasher.hash_3(hasher.hash_2(n.ownerPk, n.blinding), n.asset, n.raw),
            hasher.hash_3(n.kind, n.bundleId, n.jBundle),
            hasher.hash_2(hasher.hash_3(n.termFrom, n.termUntil, n.accruedTo), n.lock)
        );
    }

    function npkOf(Note memory n) internal view returns (uint256) {
        return hasher.hash_2(n.ownerPk, n.blinding);
    }

    /// Deposits `raw` for a fresh underlying note and clears it into the tree.
    function _depositNote(uint256 raw, uint256 blinding) internal returns (Note memory n) {
        return _depositFor(address(stock), raw, blinding, ownerPk);
    }

    /// Same, for any asset alice holds and any owner key.
    function _depositFor(address asset, uint256 raw, uint256 blinding, uint256 pk) internal returns (Note memory n) {
        n.asset = uint160(asset);
        n.raw = raw;
        n.ownerPk = pk;
        n.blinding = blinding;
        uint256 npk = npkOf(n);
        vm.startPrank(alice);
        ERC20(asset).approve(address(pool), raw);
        uint256 id = pool.deposit(asset, raw, npk);
        vm.stopPrank();
        (,,,,, uint256 commit) = pool.deposits(id);
        assertEq(commit, commitOf(n), "on-chain commit == circuit commit");
        vm.warp(block.timestamp + pool.STANDBY());
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        pool.clear(ids);
        leaves.push(commit);
    }

    function _track(uint256 commit) internal {
        if (commit != 0) leaves.push(commit);
    }

    function _indexOf(Note memory n) internal view returns (uint256) {
        uint256 c = commitOf(n);
        for (uint256 i; i < leaves.length; ++i) {
            if (leaves[i] == c) return i;
        }
        revert("note not in tree");
    }

    function _path(uint256 index) internal view returns (uint256[DEPTH] memory path) {
        uint256[] memory layer = leaves;
        for (uint256 level; level < DEPTH; ++level) {
            uint256 sib = index ^ 1;
            path[level] = sib < layer.length ? layer[sib] : zeros[level];
            uint256[] memory next = new uint256[]((layer.length + 1) / 2);
            for (uint256 i; i < next.length; ++i) {
                uint256 r = 2 * i + 1 < layer.length ? layer[2 * i + 1] : zeros[level];
                next[i] = hasher.hash_2(layer[2 * i], r);
            }
            layer = next;
            index >>= 1;
        }
    }

    // ------------------------------------------------------------ TOML

    function _s(uint256 x) internal pure returns (string memory) {
        return string.concat('"', vm.toString(x), '"');
    }

    function _kv(string memory k, uint256 v) internal pure returns (string memory) {
        return string.concat(k, " = ", _s(v), "\n");
    }

    function _noteToml(Note memory n) internal pure returns (string memory t) {
        t = string.concat("{ asset = ", _s(n.asset), ", raw = ", _s(n.raw));
        t = string.concat(t, ", kind = ", _s(n.kind), ", bundle_id = ", _s(n.bundleId));
        t = string.concat(t, ", j_bundle = ", _s(n.jBundle), ", term_from = ", _s(n.termFrom));
        t = string.concat(t, ", term_until = ", _s(n.termUntil), ", accrued_to = ", _s(n.accruedTo));
        t = string.concat(t, ", lock = ", _s(n.lock), ", owner_pk = ", _s(n.ownerPk));
        t = string.concat(t, ", blinding = ", _s(n.blinding), " }");
    }

    function _pathToml(uint256[DEPTH] memory p) internal pure returns (string memory out) {
        out = "[";
        for (uint256 i; i < DEPTH; ++i) {
            out = string.concat(out, i == 0 ? "" : ", ", _s(p[i]));
        }
        out = string.concat(out, "]");
    }

    /// Where `n` sits in the tree: `index = ...` and `path = [...]` under the given keys.
    function _witness(Note memory n, string memory indexKey, string memory pathKey)
        internal
        view
        returns (string memory)
    {
        uint256 i = _indexOf(n);
        return string.concat(_kv(indexKey, i), pathKey, " = ", _pathToml(_path(i)), "\n");
    }

    function _transferToml(
        Note memory in0,
        Note memory in1,
        Note memory out0,
        Note memory out1,
        uint256 withdrawRaw,
        address to
    ) internal view returns (string memory toml) {
        uint256[DEPTH] memory empty;
        bool real1 = in1.raw != 0;
        uint256 i0 = _indexOf(in0);
        uint256 i1 = real1 ? _indexOf(in1) : 0;
        toml = string.concat(
            _kv("root", pool.currentRoot()),
            _kv("now", block.timestamp),
            _kv("asset", in0.asset),
            _kv("withdraw_raw", withdrawRaw),
            _kv("recipient", uint160(to)),
            _kv("sk", sk)
        );
        toml = string.concat(
            toml,
            "ins = [",
            _noteToml(in0),
            ", ",
            _noteToml(in1),
            "]\n",
            string.concat("in_index = [", _s(i0), ", ", _s(i1), "]\n"),
            string.concat("in_path = [", _pathToml(_path(i0)), ", ", _pathToml(real1 ? _path(i1) : empty), "]\n"),
            string.concat("outs = [", _noteToml(out0), ", ", _noteToml(out1), "]\n")
        );
    }

    // ------------------------------------------------------------ proving

    function _prove(string memory circuit, string memory toml)
        internal
        returns (bytes memory proof, bytes32[] memory pub)
    {
        (int256 code, bytes memory out) = _tryProve(circuit, toml);
        require(code == 0, string(out));
        (proof, pub) = abi.decode(out, (bytes, bytes32[]));
    }

    /// Runs the prover without reverting; a non-zero code means the circuit rejected the witness.
    function _tryProve(string memory circuit, string memory toml) internal returns (int256, bytes memory) {
        string memory id = string.concat(
            "t", vm.toString(uint256(uint64(uint256(keccak256(abi.encode(address(this), nonce++, gasleft()))))))
        );
        vm.writeFile(string.concat("../circuits/", circuit, "/", id, ".toml"), toml);
        string[] memory cmd = new string[](4);
        cmd[0] = "bash";
        cmd[1] = "../circuits/prove.sh";
        cmd[2] = circuit;
        cmd[3] = id;
        Vm.FfiResult memory r = vm.tryFfi(cmd);
        return (r.exitCode, r.exitCode == 0 ? r.stdout : r.stderr);
    }

    function _u(bytes32 x) internal pure returns (uint256) {
        return uint256(x);
    }
}
