// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Kills the mutants the other mock-verifier suites let survive (slither-mutate campaign):
// exact state after each call, emitted events, and the public
// inputs each engine hands its verifier. No real proofs: PubVerifier records what it was asked.

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
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
import {MockStock} from "./Base.t.sol";
import {MockFeed} from "./DvPSettler.t.sol";
import {MockHasher} from "./Invariants.t.sol";

/// Accepts any proof until told which public inputs to expect; then only exactly those.
/// (verify is view, so it cannot record what it was given; it compares instead.)
contract PubVerifier is IProofVerifier {
    bool public strict;
    mapping(bytes32 => bool) public accepted;

    function expect(bytes32[] memory pub) external {
        strict = true;
        accepted[keccak256(abi.encode(pub))] = true;
    }

    function relax() external {
        strict = false;
    }

    function verify(bytes calldata, bytes32[] calldata pub) external view returns (bool) {
        return !strict || accepted[keccak256(abi.encode(pub))];
    }
}

contract MutationTest is Test {
    bytes32 internal constant VAULT = keccak256("vault");

    address internal gov = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal sequencer = makeAddr("tee");
    address internal manager = makeAddr("manager");
    address internal workers = makeAddr("workers");
    address internal treasury = makeAddr("treasury");
    address internal burnSink = makeAddr("burnSink");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");
    address internal feeSink = makeAddr("feeSink");

    PubVerifier internal v;
    PubVerifier internal orderV;
    CordonControl internal control;
    AssetGate internal gate;
    ScreeningGate internal screening;
    CordonPool internal pool;
    ActionEngine internal actions;
    BundleVerifier internal bundler;
    PriceOracle internal oracle;
    DvPSettler internal settler;
    EncumbranceRegistry internal registry;
    NavAttestor internal nav;
    SolvencyVerifier internal solvency;
    CrdnStaking internal staking;
    MockStock internal stock;
    MockStock internal crdn;
    MockFeed internal feed;
    uint256 internal t0;
    uint256 internal nonce = 1000;

    function setUp() public {
        vm.warp(1_800_000_000);
        t0 = block.timestamp;
        v = new PubVerifier();
        orderV = new PubVerifier();
        control = new CordonControl(gov, guardian, feeSink);
        gate = new AssetGate(gov);
        screening = new ScreeningGate(control);
        pool = new CordonPool(new MockHasher(), gate, control, screening, v);
        actions = new ActionEngine(gate, control);
        bundler = new BundleVerifier(pool, actions, v, v, v, v);
        oracle = new PriceOracle(gov, gate);
        settler = new DvPSettler(pool, oracle, v, orderV);
        registry = new EncumbranceRegistry(pool, v, v, v);
        nav = new NavAttestor(gov, pool, oracle, v);
        solvency = new SolvencyVerifier(pool);
        stock = new MockStock();
        crdn = new MockStock();
        staking = new CrdnStaking(crdn, workers, treasury, burnSink, pool);
        feed = new MockFeed();
        feed.set(100e8);

        vm.startPrank(gov);
        control.setEngine(address(bundler), true);
        control.setEngine(address(settler), true);
        control.setEngine(address(registry), true);
        control.setEngine(address(this), true);
        control.setKeeper(keeper, true);
        control.setSequencer(sequencer);
        gate.register(address(stock), AssetGate.Class.STOCK8056, 31, 7);
        oracle.setFeed(address(stock), feed, 1 days);
        nav.registerVault(VAULT, manager, 1);
        vm.stopPrank();
        actions.sync(address(stock));

        stock.mint(alice, 1e24);
        vm.prank(alice);
        stock.approve(address(pool), type(uint256).max);
    }

    function _next() internal returns (uint256) {
        return ++nonce;
    }

    function _one(uint256 x) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }

    function _b(uint256 x) internal pure returns (bytes32) {
        return bytes32(x);
    }

    function _a(address x) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(x)));
    }

    function _deposit(uint256 raw) internal returns (uint256 id) {
        vm.prank(alice);
        id = pool.deposit(address(stock), raw, _next());
    }

    function _depositAndClear(uint256 raw) internal {
        uint256 id = _deposit(raw);
        vm.warp(block.timestamp + pool.STANDBY());
        pool.clear(_one(id));
    }

    // =============================================================== CordonPool

    function test_pool_transactBindsInputsAndPays() public {
        _depositAndClear(1000);
        CordonPool.Transfer memory t;
        t.root = pool.currentRoot();
        t.now_ = block.timestamp - 10;
        t.asset = address(stock);
        t.withdrawRaw = 400;
        t.recipient = bob;
        t.nullifiers = [_next(), _next()];
        t.commits = [_next(), _next()];
        bytes32[] memory p = new bytes32[](9);
        (p[0], p[1], p[2], p[3], p[4]) = (_b(t.root), _b(t.now_), _a(t.asset), _b(400), _a(bob));
        (p[5], p[6], p[7], p[8]) = (_b(t.nullifiers[0]), _b(t.nullifiers[1]), _b(t.commits[0]), _b(t.commits[1]));
        v.expect(p);

        uint256 leaves = pool.nextLeaf();
        uint256 idx = pool.rootIndex();
        vm.expectEmit(address(pool));
        emit CordonPool.Nullified(t.nullifiers[0]);
        vm.expectEmit(address(pool));
        emit CordonPool.Nullified(t.nullifiers[1]);
        vm.expectEmit(address(pool));
        emit CordonPool.Withdrawn(address(stock), 400);
        pool.transact("", t);

        assertEq(stock.balanceOf(bob), 400);
        assertEq(pool.owed(address(stock)), 600);
        assertTrue(pool.nullified(t.nullifiers[0]));
        assertTrue(pool.nullified(t.nullifiers[1]));
        assertEq(pool.nextLeaf(), leaves + 2);
        assertEq(pool.rootIndex(), idx + 1, "one root per call");
        assertTrue(pool.isKnownRoot(pool.currentRoot()));

        // A proof exactly MAX_PROOF_AGE old still passes; one second older does not.
        t.now_ = block.timestamp - pool.MAX_PROOF_AGE();
        t.withdrawRaw = 0;
        t.nullifiers = [_next(), _next()];
        t.commits = [uint256(0), uint256(0)];
        t.root = pool.currentRoot();
        (p[0], p[1], p[3]) = (_b(t.root), _b(t.now_), 0);
        (p[5], p[6], p[7], p[8]) = (_b(t.nullifiers[0]), _b(t.nullifiers[1]), 0, 0);
        v.expect(p);
        idx = pool.rootIndex();
        pool.transact("", t);
        assertEq(pool.rootIndex(), idx, "no outputs, no new root");
        assertEq(stock.balanceOf(bob), 400);
    }

    function test_pool_depositRecordsAndBounds() public {
        uint256 npk = _next();
        uint256 raw = 2 ** 120 - 1; // largest accepted amount
        stock.mint(alice, raw);
        vm.prank(alice);
        uint256 id = pool.deposit(address(stock), raw, npk);
        (address origin, address asset, uint128 r, uint64 at, bool settled, uint256 commit) = pool.deposits(id);
        assertEq(origin, alice);
        assertEq(asset, address(stock));
        assertEq(r, raw);
        assertEq(at, block.timestamp);
        assertFalse(settled);
        assertEq(commit, _depositCommit(npk, raw));
        assertEq(pool.owed(address(stock)), raw);

        // npk = FIELD - 1 is a field element; FIELD is not.
        vm.prank(alice);
        pool.deposit(address(stock), 1, 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000);
        _clearsAfterStandby(id, commit);
    }

    /// The commitment is h3(h3(npk, asset, raw), h3(0,0,0), h2(h3(0,0,0), 0)).
    function _depositCommit(uint256 npk, uint256 raw) internal returns (uint256) {
        MockHasher h = new MockHasher();
        uint256 z3 = h.hash_3(0, 0, 0);
        return h.hash_3(h.hash_3(npk, uint160(address(stock)), raw), z3, h.hash_2(z3, 0));
    }

    /// Clears exactly at the end of standby, not a second before, as leaf 0.
    function _clearsAfterStandby(uint256 id, uint256 commit) internal {
        MockHasher h = new MockHasher();
        vm.warp(block.timestamp + pool.STANDBY() - 1);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.InStandby.selector, id));
        pool.clear(_one(id));
        vm.warp(block.timestamp + 1);
        uint256 node = commit;
        uint256 z;
        for (uint256 i; i < 32; ++i) {
            node = h.hash_2(node, z);
            z = h.hash_2(z, z);
        }
        vm.expectEmit(address(pool));
        emit CordonPool.Inserted(0, commit, node);
        pool.clear(_one(id));
        assertEq(pool.currentRoot(), node);
        (,,,, bool settled,) = pool.deposits(id);
        assertTrue(settled);
    }

    function test_pool_treeRootsMatchReference() public {
        // Rebuild the root off-chain-style (MockHasher) for three leaves: the pool must agree.
        MockHasher h = new MockHasher();
        uint256[3] memory c = [_next(), _next(), _next()];
        pool.applyOp(pool.currentRoot(), new uint256[](0), _one(c[0]));
        uint256[] memory two = new uint256[](2);
        (two[0], two[1]) = (c[1], c[2]);
        pool.applyOp(pool.currentRoot(), new uint256[](0), two);
        uint256 z;
        uint256[32] memory zeros;
        for (uint256 i; i < 32; ++i) {
            zeros[i] = z;
            z = h.hash_2(z, z);
        }
        assertEq(pool.roots(0), z, "empty root");
        uint256 node = h.hash_2(h.hash_2(c[0], c[1]), h.hash_2(c[2], 0));
        for (uint256 i = 2; i < 32; ++i) {
            node = h.hash_2(node, zeros[i]);
        }
        assertEq(pool.currentRoot(), node);
        assertEq(pool.rootIndex(), 2);
        assertEq(pool.nextLeaf(), 3);
        assertTrue(pool.isKnownRoot(pool.roots(1)));
        assertFalse(pool.isKnownRoot(0));
        assertFalse(pool.isKnownRoot(node + 1));
    }

    function test_pool_rootHistoryWraps() public {
        uint256 first = pool.currentRoot();
        for (uint256 i; i < 100; ++i) {
            pool.applyOp(pool.currentRoot(), new uint256[](0), _one(_next()));
        }
        assertEq(pool.rootIndex(), 0, "index wraps at ROOT_HISTORY");
        assertFalse(pool.isKnownRoot(first), "oldest root dropped");
        assertTrue(pool.isKnownRoot(pool.roots(99)));
        assertTrue(pool.isKnownRoot(pool.roots(1)));
    }

    function test_pool_applyOpSkipsZerosAndRejectsNonField() public {
        uint256[] memory ns = new uint256[](3);
        (ns[0], ns[2]) = (_next(), _next());
        uint256[] memory cs = new uint256[](3);
        cs[1] = _next();
        uint256 idx = pool.rootIndex();
        pool.applyOp(pool.currentRoot(), ns, cs);
        assertTrue(pool.nullified(ns[0]));
        assertTrue(pool.nullified(ns[2]));
        assertFalse(pool.nullified(0));
        assertEq(pool.nextLeaf(), 1);
        assertEq(pool.rootIndex(), idx + 1);

        uint256 root = pool.currentRoot();
        pool.applyOp(root, new uint256[](0), new uint256[](2));
        assertEq(pool.rootIndex(), idx + 1, "all-zero commits push no root");

        uint256 field = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        vm.expectRevert(CordonPool.NotField.selector);
        pool.applyOp(root, new uint256[](0), _one(field));
        pool.applyOp(root, new uint256[](0), _one(field - 1));
    }

    function test_pool_unshieldAndFees() public {
        uint256 id = _deposit(700);
        uint256 before = stock.balanceOf(alice);
        vm.expectEmit(address(pool));
        emit CordonPool.Returned(id);
        vm.prank(alice);
        pool.unshieldToOrigin(id);
        assertEq(stock.balanceOf(alice), before + 700);
        assertEq(pool.owed(address(stock)), 0);

        _deposit(500);
        vm.expectEmit(address(pool));
        emit CordonPool.FeeCredited(address(stock), 30);
        pool.creditFee(address(stock), 30);
        assertEq(pool.owed(address(stock)), 470);
        assertEq(pool.fees(address(stock)), 30);
        vm.expectEmit(address(pool));
        emit CordonPool.FeesCollected(address(stock), 30, feeSink);
        pool.collectFees(address(stock));
        assertEq(stock.balanceOf(feeSink), 30);
        assertEq(pool.fees(address(stock)), 0);
    }

    // =============================================================== BundleVerifier

    function test_bundle_bindsInputs() public {
        _depositAndClear(1000);
        // Income after the first checkpoint, so the index in force differs from 1e36.
        stock.setMultiplier(1.01e18);
        actions.sync(address(stock));
        vm.warp(block.timestamp + 2 hours);

        BundleVerifier.Bundle memory b;
        b.root = pool.currentRoot();
        b.now_ = block.timestamp - bundler.MAX_PROOF_AGE(); // oldest accepted
        b.asset = address(stock);
        b.feeRaw = 10;
        b.nullifier = _next();
        bytes32[] memory p = new bytes32[](12);
        for (uint256 i; i < 5; ++i) {
            b.commits[i] = _next();
            p[7 + i] = _b(b.commits[i]);
        }
        (, uint256 jAt) = actions.checkpointAt(address(stock), b.now_);
        assertEq(jAt, uint256(1e36) * 1e18 / 1.01e18);
        (p[0], p[1], p[2], p[3]) = (_b(b.root), _b(b.now_), _a(address(stock)), _b(jAt));
        (p[4], p[5], p[6]) = (_b(31), _b(10), _b(b.nullifier));
        v.expect(p);
        uint256 leaves = pool.nextLeaf();
        bundler.bundle("", b);
        assertTrue(pool.nullified(b.nullifier));
        assertEq(pool.nextLeaf(), leaves + 5);
        assertEq(pool.fees(address(stock)), 10);
    }

    function test_bundle_unbundleBindsCheckpoint() public {
        _depositAndClear(1000);
        uint256 t1 = block.timestamp;
        stock.setMultiplier(1.01e18);
        actions.sync(address(stock));
        vm.warp(t1 + 100);
        stock.setMultiplier(1.02e18);
        actions.sync(address(stock));

        BundleVerifier.Unbundle memory u;
        u.root = pool.currentRoot();
        u.now_ = t1 + 50; // between the two checkpoints
        u.asset = address(stock);
        u.commit = _next();
        bytes32[] memory p = new bytes32[](12);
        for (uint256 i; i < 5; ++i) {
            u.nullifiers[i] = _next();
            p[6 + i] = _b(u.nullifiers[i]);
        }
        (uint256 ts, uint256 j) = actions.checkpointAt(address(stock), u.now_);
        assertEq(ts, t1);
        (p[0], p[1], p[2], p[3], p[4], p[5]) = (_b(u.root), _b(u.now_), _a(address(stock)), _b(j), _b(ts), _b(31));
        p[11] = _b(u.commit);
        v.expect(p);
        uint256 leaves = pool.nextLeaf();
        bundler.unbundle("", u);
        assertEq(pool.nextLeaf(), leaves + 1);
        for (uint256 i; i < 5; ++i) {
            assertTrue(pool.nullified(u.nullifiers[i]));
        }
    }

    function test_bundle_termAndClaimBindInputs() public {
        _depositAndClear(1000);
        BundleVerifier.Term memory t;
        t.root = pool.currentRoot();
        t.now_ = block.timestamp;
        t.nullifier = _next();
        t.commits = [_next(), _next()];
        bytes32[] memory p = new bytes32[](5);
        (p[0], p[1], p[2], p[3], p[4]) = (_b(t.root), _b(t.now_), _b(t.nullifier), _b(t.commits[0]), _b(t.commits[1]));
        v.expect(p);
        uint256 leaves = pool.nextLeaf();
        bundler.term("", t);
        assertEq(pool.nextLeaf(), leaves + 2);
        assertTrue(pool.nullified(t.nullifier));

        uint256 tStart = block.timestamp;
        vm.warp(tStart + 100);
        stock.setMultiplier(1.01e18);
        BundleVerifier.Claim memory c;
        c.root = pool.currentRoot();
        c.asset = address(stock);
        c.tStart = tStart;
        c.tEnd = block.timestamp; // a claim may end now
        c.nullifier = _next();
        c.next = _next();
        c.payout = _next();
        actions.sync(address(stock));
        p = new bytes32[](9);
        (p[0], p[1], p[2], p[3]) = (_b(c.root), _a(address(stock)), _b(c.tStart), _b(c.tEnd));
        (p[4], p[5]) = (_b(actions.indexAt(address(stock), tStart)), _b(actions.indexAt(address(stock), c.tEnd)));
        assertTrue(p[4] != p[5]);
        (p[6], p[7], p[8]) = (_b(c.nullifier), _b(c.next), _b(c.payout));
        v.expect(p);
        leaves = pool.nextLeaf();
        bundler.claimIncome("", c);
        assertEq(pool.nextLeaf(), leaves + 2);
        assertTrue(pool.nullified(c.nullifier));
    }

    // =============================================================== EncumbranceRegistry

    function _encumber(uint8 kind, uint64 until, uint256 secret)
        internal
        returns (EncumbranceRegistry.Encumber memory e)
    {
        e.root = pool.currentRoot();
        e.asset = address(stock);
        e.kind = kind;
        e.until = until;
        e.releaseHash = pool.hasher().hash_1(secret);
        e.nullifier = _next();
        e.lockedCommit = _next();
        e.encCommit = _next();
        registry.encumber("", e);
    }

    function test_enc_encumberBindsAndRecords() public {
        EncumbranceRegistry.Encumber memory e;
        e.root = pool.currentRoot();
        e.asset = address(stock);
        e.kind = registry.LIEN();
        e.until = uint64(block.timestamp + 1 days);
        e.releaseHash = 77;
        e.nullifier = _next();
        e.lockedCommit = _next();
        e.encCommit = _next();
        bytes32[] memory p = new bytes32[](8);
        (p[0], p[1], p[2], p[3]) = (_b(e.root), _a(address(stock)), _b(2), _b(e.until));
        (p[4], p[5], p[6], p[7]) = (_b(77), _b(e.nullifier), _b(e.lockedCommit), _b(e.encCommit));
        v.expect(p);
        vm.roll(1234);
        vm.expectEmit(address(registry));
        emit EncumbranceRegistry.Encumbered(e.encCommit, 2, e.until);
        registry.encumber("", e);

        (bool exists, uint8 kind, uint64 until, uint64 created, bool rel, bool def, bool enf, uint256 rh) =
            registry.encumbrances(e.encCommit);
        assertTrue(exists);
        assertEq(kind, 2);
        assertEq(until, e.until);
        assertEq(created, 1234);
        assertFalse(rel || def || enf);
        assertEq(rh, 77);
        assertEq(registry.count(), 1);
        assertTrue(pool.nullified(e.nullifier));
        assertEq(pool.nextLeaf(), 1);
    }

    function test_enc_templateBits() public {
        // Only PLEDGE (bit 1) allowed: LOCKUP (bit 0) and LIEN (bit 2) are refused.
        vm.prank(gov);
        gate.setTemplates(address(stock), 2);
        uint64 until = uint64(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(EncumbranceRegistry.TemplateNotAllowed.selector, address(stock), 0));
        this.encumberExt(0, until);
        vm.expectRevert(abi.encodeWithSelector(EncumbranceRegistry.TemplateNotAllowed.selector, address(stock), 2));
        this.encumberExt(2, until);
        this.encumberExt(1, until);
        vm.expectRevert(abi.encodeWithSelector(EncumbranceRegistry.TemplateNotAllowed.selector, address(stock), 3));
        this.encumberExt(3, until);
    }

    function encumberExt(uint8 kind, uint64 until) external {
        _encumber(kind, until, 5);
    }

    function test_enc_releaseUnlockAndLockupExpiry() public {
        EncumbranceRegistry.Encumber memory e = _encumber(registry.PLEDGE(), uint64(block.timestamp + 1 days), 42);
        assertFalse(registry.isReleased(e.encCommit));
        vm.expectRevert(EncumbranceRegistry.WrongSecret.selector);
        registry.release(e.encCommit, 41);
        vm.expectEmit(address(registry));
        emit EncumbranceRegistry.Released(e.encCommit);
        registry.release(e.encCommit, 42);
        assertTrue(registry.isReleased(e.encCommit));
        (,,,, bool rel,,,) = registry.encumbrances(e.encCommit);
        assertTrue(rel);

        // A released note cannot be defaulted.
        vm.prank(keeper);
        vm.expectRevert(EncumbranceRegistry.AlreadySettled.selector);
        registry.declareDefault(e.encCommit);

        EncumbranceRegistry.Spend memory s;
        s.root = pool.currentRoot();
        s.encCommit = e.encCommit;
        s.nullifier = _next();
        s.commits = _one(_next());
        bytes32[] memory p = new bytes32[](4);
        (p[0], p[1], p[2], p[3]) = (_b(s.root), _b(s.encCommit), _b(s.nullifier), _b(s.commits[0]));
        v.expect(p);
        uint256 leaves = pool.nextLeaf();
        vm.expectEmit(address(registry));
        emit EncumbranceRegistry.Unlocked(e.encCommit);
        registry.unlock("", s);
        assertTrue(pool.nullified(s.nullifier));
        assertEq(pool.nextLeaf(), leaves + 1);
        v.relax();

        // A LOCKUP releases itself exactly at `until`.
        uint64 until = uint64(block.timestamp + 1 days);
        EncumbranceRegistry.Encumber memory l = _encumber(registry.LOCKUP(), until, 1);
        vm.warp(until - 1);
        assertFalse(registry.isReleased(l.encCommit));
        vm.warp(until);
        assertTrue(registry.isReleased(l.encCommit));
        // A PLEDGE past its `until` is not released by time.
        EncumbranceRegistry.Encumber memory q = _encumber(registry.PLEDGE(), until, 2);
        assertFalse(registry.isReleased(q.encCommit));
        assertFalse(registry.isReleased(_next()), "unknown is never released");
    }

    function test_enc_defaultAndEnforce() public {
        EncumbranceRegistry.Encumber memory e = _encumber(registry.LIEN(), uint64(block.timestamp + 1 days), 9);
        vm.expectEmit(address(registry));
        emit EncumbranceRegistry.Defaulted(e.encCommit);
        vm.prank(keeper);
        registry.declareDefault(e.encCommit);
        (,,,,, bool def,,) = registry.encumbrances(e.encCommit);
        assertTrue(def);
        vm.expectRevert(EncumbranceRegistry.AlreadySettled.selector);
        registry.release(e.encCommit, 9);

        EncumbranceRegistry.Spend memory s;
        s.root = pool.currentRoot();
        s.encCommit = e.encCommit;
        s.nullifier = _next();
        s.commits = new uint256[](5);
        bytes32[] memory p = new bytes32[](8);
        (p[0], p[1], p[2]) = (_b(s.root), _b(s.encCommit), _b(s.nullifier));
        for (uint256 i; i < 5; ++i) {
            s.commits[i] = _next();
            p[3 + i] = _b(s.commits[i]);
        }
        v.expect(p);
        uint256 leaves = pool.nextLeaf();
        vm.expectEmit(address(registry));
        emit EncumbranceRegistry.Enforced(e.encCommit);
        registry.enforce("", s);
        assertEq(pool.nextLeaf(), leaves + 5);
        (,,,,,, bool enf,) = registry.encumbrances(e.encCommit);
        assertTrue(enf);
        assertFalse(registry.isReleased(e.encCommit));
        v.relax();

        // A released-then-enforced state never reads as released; wrong output count is refused.
        EncumbranceRegistry.Encumber memory f = _encumber(registry.LIEN(), uint64(block.timestamp + 1 days), 3);
        vm.prank(keeper);
        registry.declareDefault(f.encCommit);
        s.encCommit = f.encCommit;
        s.commits = new uint256[](4);
        vm.expectRevert(EncumbranceRegistry.InvalidProof.selector);
        registry.enforce("", s);
    }

    // =============================================================== NavAttestor

    function test_nav_bindsInputs() public {
        NavAttestor.Attestation memory a;
        a.epoch = 1;
        a.navPerShare18 = 1.05e18;
        a.totalShares = 1000e18;
        a.queueUsdg = 5e6;
        a.liabilities = 5e6 * nav.USDG_RAW_TO_USD27(); // exactly the queue: allowed
        a.root = pool.currentRoot();
        a.holdingsRoot = 42;
        a.nullifiers[3] = _next();
        a.nullifiers[15] = _next();
        NavAttestor.Price[16] memory pr;
        pr[2] = NavAttestor.Price(address(stock), 1);

        bytes32[] memory p = new bytes32[](55);
        (p[0], p[1], p[2], p[3], p[4], p[5]) =
        (_b(a.root), _b(1), _b(1), _b(a.navPerShare18), _b(a.totalShares), _b(a.liabilities));
        p[6 + 2] = _a(address(stock));
        p[6 + 16 + 2] = _b(oracle.rawPrice(address(stock), 1));
        p[38] = _b(42);
        p[39 + 3] = _b(a.nullifiers[3]);
        p[39 + 15] = _b(a.nullifiers[15]);
        v.expect(p);
        vm.prank(manager);
        nav.attest(VAULT, a, pr, "");
        (,, uint64 epoch,,,, uint256 queue, uint256 hr) = nav.vaults(VAULT);
        assertEq(epoch, 1);
        assertEq(queue, 5e6);
        assertEq(hr, 42);

        // Exactly one EPOCH later the next attestation is accepted.
        vm.warp(block.timestamp + nav.EPOCH() - 1);
        a.epoch = 2;
        p[2] = _b(2);
        v.expect(p);
        vm.prank(manager);
        vm.expectRevert(NavAttestor.TooEarly.selector);
        nav.attest(VAULT, a, pr, "");
        vm.warp(block.timestamp + 1);
        feed.set(100e8);
        vm.prank(manager);
        nav.attest(VAULT, a, pr, "");
        (uint64 hts,,) = nav.history(VAULT, 2);
        assertEq(hts, block.timestamp);
    }

    // =============================================================== DvPSettler

    function test_dvp_bindsInputs() public {
        vm.warp(block.timestamp + 10 minutes);
        uint256 now_ = block.timestamp - settler.MAX_PROOF_AGE(); // oldest accepted
        DvPSettler.Price[16] memory pr;
        pr[0] = DvPSettler.Price(address(stock), 0, 1, 0);
        pr[3] = DvPSettler.Price(address(stock), 1, 0, 5e26);
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](1);
        DvPSettler.Trade memory t = trades[0];
        t.root = pool.currentRoot();
        t.toleranceBps = settler.MAX_TOLERANCE_BPS(); // widest accepted
        t.orders[0].orderHash = 11;
        t.orders[1].orderHash = 22;
        t.orders[0].nullifiers[2] = _next();
        t.orders[1].nullifiers[7] = _next();
        t.commits[0] = _next();
        t.commits[31] = _next();
        t.memos[0] = 5;
        t.memos[15] = 6;

        bytes32[] memory p = new bytes32[](101);
        (p[0], p[1], p[2]) = (_b(t.root), _b(now_), _b(t.toleranceBps));
        (p[3], p[3 + 16], p[3 + 32]) = (_a(address(stock)), 0, _b(oracle.rawPriceAt(address(stock), 1, now_)));
        (p[6], p[6 + 16], p[6 + 32]) = (_a(address(stock)), _b(1), _b(5e26));
        (p[51], p[52]) = (_b(11), _b(22));
        (p[53], p[53 + 31]) = (_b(t.commits[0]), _b(t.commits[31]));
        (p[85], p[100]) = (_b(5), _b(6));
        v.expect(p);
        for (uint256 o; o < 2; ++o) {
            bytes32[] memory op = new bytes32[](9);
            op[0] = _b(t.orders[o].orderHash);
            for (uint256 i; i < 8; ++i) {
                op[1 + i] = _b(t.orders[o].nullifiers[i]);
            }
            orderV.expect(op);
        }
        vm.expectEmit(address(settler));
        emit DvPSettler.TradeSettled(0, 11, 22, t.memos);
        vm.expectEmit(address(settler));
        emit DvPSettler.BatchSettled(0, 1, 2, keccak256(abi.encode(pr)));
        vm.prank(sequencer);
        settler.submitBatch(now_, pr, trades);
        assertTrue(pool.nullified(t.orders[0].nullifiers[2]));
        assertTrue(pool.nullified(t.orders[1].nullifiers[7]));
        assertEq(pool.nextLeaf(), 2);
        assertEq(settler.batchSeq(), 1);
    }

    // =============================================================== CordonControl / AssetGate

    function test_control_flagsAndEvents() public {
        CordonControl c = new CordonControl(gov, guardian, feeSink);
        assertEq(c.guardian(), guardian);
        assertEq(c.feeRecipient(), feeSink);
        assertEq(c.owner(), gov);
        vm.expectRevert(CordonControl.ZeroAddress.selector);
        new CordonControl(gov, address(0), feeSink);

        vm.expectEmit(address(c));
        emit CordonControl.Paused(0xff);
        vm.prank(guardian);
        c.pause(0xff);
        assertEq(c.paused(), 15, "only the four known bits");
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, 4));
        c.requireActive(4);
        c.requireActive(16);

        vm.expectEmit(address(c));
        emit CordonControl.Unpaused(5);
        vm.prank(gov);
        c.unpause(5);
        assertEq(c.paused(), 10);
        c.requireActive(1);
        c.requireActive(4);
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, 2));
        c.requireActive(2);
        vm.prank(gov);
        c.pause(1); // the owner may pause too
        assertEq(c.paused(), 11);

        vm.startPrank(gov);
        vm.expectEmit(address(c));
        emit CordonControl.EngineSet(bob, true);
        c.setEngine(bob, true);
        assertTrue(c.isEngine(bob));
        c.setEngine(bob, false);
        assertFalse(c.isEngine(bob));
        vm.expectEmit(address(c));
        emit CordonControl.KeeperSet(bob, true);
        c.setKeeper(bob, true);
        assertTrue(c.isKeeper(bob));
        vm.expectEmit(address(c));
        emit CordonControl.SequencerSet(bob);
        c.setSequencer(bob);
        assertEq(c.sequencer(), bob);
        vm.expectEmit(address(c));
        emit CordonControl.FeeRecipientSet(address(0));
        c.setFeeRecipient(address(0));
        assertEq(c.feeRecipient(), address(0));
        vm.stopPrank();
    }

    function test_gate_masksModesAndEvents() public {
        AssetGate g = new AssetGate(gov);
        address a1 = makeAddr("a1");
        address a2 = makeAddr("a2");
        vm.startPrank(gov);
        vm.expectRevert(AssetGate.BadMask.selector);
        g.register(a1, AssetGate.Class.TREASURY, 1, 0);
        vm.expectRevert(AssetGate.BadMask.selector);
        g.register(a1, AssetGate.Class.TREASURY, 2, 0);
        vm.expectRevert(AssetGate.BadMask.selector);
        g.register(a1, AssetGate.Class.TREASURY, 35, 0);
        vm.expectRevert(AssetGate.BadMask.selector);
        g.register(a1, AssetGate.Class.TREASURY, 3, 8);
        vm.expectEmit(address(g));
        emit AssetGate.AssetRegistered(a1, AssetGate.Class.TREASURY, 3, 7);
        g.register(a1, AssetGate.Class.TREASURY, 3, 7);
        g.register(a2, AssetGate.Class.VAULT4626, 31, 0);
        vm.stopPrank();

        (AssetGate.Class cls, AssetGate.Mode mode, uint8 claims, uint8 templates) = g.assets(a1);
        assertEq(uint8(cls), uint8(AssetGate.Class.TREASURY));
        assertEq(uint8(mode), uint8(AssetGate.Mode.ACTIVE));
        assertEq(claims, 3);
        assertEq(templates, 7);
        assertEq(g.claimMask(a2), 31);
        assertEq(uint8(g.classOf(a2)), uint8(AssetGate.Class.VAULT4626));
        assertEq(g.assetCount(), 2);
        assertEq(g.assetList(1), a2);
        assertTrue(g.isActive(a1));
        assertTrue(g.isKnown(a1));
        assertFalse(g.isKnown(bob));
        assertFalse(g.isActive(bob));

        vm.startPrank(gov);
        vm.expectEmit(address(g));
        emit AssetGate.ModeSet(a1, AssetGate.Mode.REDEEM_ONLY);
        g.setMode(a1, AssetGate.Mode.REDEEM_ONLY);
        assertFalse(g.isActive(a1));
        assertTrue(g.isKnown(a1));
        g.setMode(a1, AssetGate.Mode.ACTIVE);
        assertTrue(g.isActive(a1));
        vm.expectRevert(abi.encodeWithSelector(AssetGate.UnknownAsset.selector, a1));
        g.setMode(a1, AssetGate.Mode.NONE);
        g.setTemplates(a1, 7);
        vm.expectRevert(AssetGate.BadMask.selector);
        g.setTemplates(a1, 8);
        vm.stopPrank();
    }

    // =============================================================== CrdnStaking

    function _fund(address who, uint256 amount) internal {
        crdn.mint(who, amount);
        vm.prank(who);
        crdn.approve(address(staking), amount);
    }

    function _stake(address who, uint256 amount) internal {
        _fund(who, amount);
        vm.prank(who);
        staking.stake(amount);
    }

    function test_staking_crdnListedIsNeverAFee() public {
        // CRDN listed as an asset: the sweep must skip it, or stakes would be paid out as fees.
        vm.prank(gov);
        gate.register(address(crdn), AssetGate.Class.STOCK8056, 31, 7);
        _fund(alice, 1000);
        vm.expectEmit(address(staking));
        emit CrdnStaking.Staked(alice, 1000);
        vm.prank(alice);
        staking.stake(1000);
        _stake(bob, 500);
        assertEq(crdn.balanceOf(address(staking)), 1500);
        assertEq(crdn.balanceOf(workers) + crdn.balanceOf(treasury) + crdn.balanceOf(burnSink), 0);
        assertEq(staking.totalStaked(), 1500);
        assertEq(staking.staked(alice), 1000);
        assertEq(staking.lockedUntil(alice), block.timestamp + 7 days);
    }

    function test_staking_sweepCollectsPoolFees() public {
        vm.prank(gov);
        control.setFeeRecipient(address(staking));
        _stake(alice, 1000);
        _deposit(10_000);
        pool.creditFee(address(stock), 100);
        // The next stake sweeps the pool's fees and splits them before it counts.
        _fund(bob, 1000);
        vm.expectEmit(address(staking));
        emit CrdnStaking.FeesDistributed(address(stock), 80, 10, 5, 5);
        vm.prank(bob);
        staking.stake(1000);
        assertEq(pool.fees(address(stock)), 0);
        assertEq(stock.balanceOf(workers), 80);
        assertEq(stock.balanceOf(treasury), 10);
        assertEq(stock.balanceOf(burnSink), 5);
        assertEq(staking.claimable(alice, address(stock)), 5);
        assertEq(staking.claimable(bob, address(stock)), 0);
        assertEq(staking.booked(address(stock)), 5);
        assertEq(staking.feeTokens(0), address(stock));
        assertEq(staking.accPerStake(address(stock)), uint256(5) * 1e36 / 1000);

        // Not the fee recipient: the sweep leaves pool fees alone.
        vm.prank(gov);
        control.setFeeRecipient(feeSink);
        pool.creditFee(address(stock), 50);
        _stake(bob, 1);
        assertEq(pool.fees(address(stock)), 50);

        vm.expectEmit(address(staking));
        emit CrdnStaking.Claimed(alice, address(stock), 5);
        vm.prank(alice);
        staking.claim(address(stock));
        assertEq(stock.balanceOf(alice), 1e24 - 10_000 + 5);
        assertEq(staking.booked(address(stock)), 0);
        assertEq(staking.owed(address(stock), alice), 0);
    }

    function test_staking_noStakersShareToWorkers() public {
        stock.mint(address(staking), 1000);
        vm.expectEmit(address(staking));
        emit CrdnStaking.FeesDistributed(address(stock), 850, 100, 0, 50);
        staking.distribute(address(stock));
        assertEq(stock.balanceOf(workers), 850);
        assertEq(stock.balanceOf(treasury), 100);
        assertEq(stock.balanceOf(burnSink), 50);
        assertEq(staking.booked(address(stock)), 0);
        staking.distribute(address(stock)); // nothing fresh: no-op
        assertEq(stock.balanceOf(workers), 850);

        // Rounding dust goes to workers: 19 -> treasury floor(1.9) = 1, burn floor(0.95) = 0.
        stock.mint(address(staking), 19);
        vm.expectEmit(address(staking));
        emit CrdnStaking.FeesDistributed(address(stock), 18, 1, 0, 0);
        staking.distribute(address(stock));
        assertEq(stock.balanceOf(workers), 868);
        assertEq(stock.balanceOf(treasury), 101);
        assertEq(stock.balanceOf(burnSink), 50);
    }

    function test_staking_unstakeSettlesAndVotes() public {
        _stake(alice, 1000);
        _stake(bob, 3000);
        stock.mint(address(staking), 10_000);
        staking.distribute(address(stock));

        vm.prank(alice);
        uint256 id = staking.propose(CrdnStaking.Subject.TEMPLATE, keccak256("x"));
        (CrdnStaking.Subject subj, bytes32 dh, uint64 ends,,) = staking.proposals(id);
        assertEq(uint8(subj), uint8(CrdnStaking.Subject.TEMPLATE));
        assertEq(dh, keccak256("x"));
        assertEq(ends, block.timestamp + 5 days);

        vm.expectEmit(address(staking));
        emit CrdnStaking.Voted(id, bob, false, 3000);
        vm.prank(bob);
        staking.vote(id, false);
        vm.prank(alice);
        staking.vote(id, true);
        (,,, uint256 forV, uint256 againstV) = staking.proposals(id);
        assertEq(forV, 1000);
        assertEq(againstV, 3000);
        // The stake lock (7 days) outlasts the vote (5 days): it is not shortened.
        assertEq(staking.lockedUntil(bob), block.timestamp + 7 days);

        // A vote that ends after the stake lock extends it.
        vm.warp(block.timestamp + 6 days);
        vm.prank(alice);
        uint256 id2 = staking.propose(CrdnStaking.Subject.ASSET_CLASS, keccak256("y"));
        vm.prank(bob);
        staking.vote(id2, true);
        assertEq(staking.lockedUntil(bob), block.timestamp + 5 days);
        vm.warp(block.timestamp + 5 days - 1);
        vm.prank(alice);
        staking.vote(id2, false); // open until its last second
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        vm.expectRevert(CrdnStaking.VotingClosed.selector);
        staking.vote(id2, true);

        // Unstake settles owed fees first; the stake leaves.
        vm.expectEmit(address(staking));
        emit CrdnStaking.Unstaked(bob, 3000);
        vm.prank(bob);
        staking.unstake(3000);
        assertEq(staking.owed(address(stock), bob), 375);
        assertEq(staking.totalStaked(), 1000);
        assertEq(crdn.balanceOf(bob), 3000);
        assertEq(staking.claimable(bob, address(stock)), 375);
        assertEq(staking.paid(address(stock), bob), staking.accPerStake(address(stock)));
    }

    // =============================================================== SolvencyVerifier / PriceOracle

    function test_solvency_epochBoundaryAndEvent() public {
        _deposit(1000);
        pool.creditFee(address(stock), 10);
        vm.expectEmit(address(solvency));
        emit SolvencyVerifier.Solvent(address(stock), 1, 1000, 1000);
        SolvencyVerifier.Record memory r = solvency.attest(address(stock));
        assertEq(r.liveClaims, 1000);
        assertEq(r.poolBalance, 1000);
        vm.warp(block.timestamp + 1 hours - 1);
        vm.expectRevert(SolvencyVerifier.TooEarly.selector);
        solvency.attest(address(stock));
        vm.warp(block.timestamp + 1);
        stock.mint(address(pool), 5); // a surplus is fine
        r = solvency.attest(address(stock));
        assertEq(r.epoch, 2);
        assertEq(r.poolBalance, 1005);
    }

    function test_oracle_heartbeatBoundaries() public {
        vm.startPrank(gov);
        oracle.setFeed(address(stock), feed, 60);
        oracle.setFeed(address(stock), feed, 1 days);
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), feed, 59);
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), feed, 1 days + 1);
        oracle.setFeed(address(stock), feed, 1 hours);
        vm.stopPrank();
        // Fresh up to exactly the heartbeat.
        vm.warp(block.timestamp + 1 hours);
        assertEq(oracle.rawPrice(address(stock), 1), 100e27 / 1e18);
        assertTrue(oracle.ok(address(stock), 1));
        vm.warp(block.timestamp + 1);
        assertFalse(oracle.ok(address(stock), 1));
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, address(stock), 1));
        oracle.rawPrice(address(stock), 1);
    }

    function test_oracle_multiplierAndActionBoundary() public {
        // A corporate action at the round's own time is fine; one after it is refused.
        stock.setMultiplier(1.5e18); // effectiveAt = now = feed time
        assertEq(oracle.rawPrice(address(stock), 1), uint256(100e27) * 1.5e18 / 1e18 / 1e18);
        vm.warp(block.timestamp + 1);
        stock.setMultiplier(2e18);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, address(stock), 1));
        oracle.rawPrice(address(stock), 1);
        feed.set(100e8);
        assertEq(oracle.rawPrice(address(stock), 1), uint256(100e27) * 2 / 1e18);
        feed.set(0);
        assertFalse(oracle.ok(address(stock), 1));
        feed.set(-1);
        assertFalse(oracle.ok(address(stock), 1));
    }

    // =============================================================== ActionEngine

    function _fresh() internal returns (MockStock s) {
        s = new MockStock();
        vm.prank(gov);
        gate.register(address(s), AssetGate.Class.STOCK8056, 31, 7);
        actions.sync(address(s));
    }

    function test_actions_scheduledSplitIsApplied() public {
        MockStock s = _fresh();
        vm.expectEmit(address(actions));
        emit ActionEngine.SplitScheduled(address(s), 2, 1, t0 + 10);
        vm.prank(keeper);
        actions.scheduleSplit(address(s), 2, 1, uint64(t0 + 10));
        (uint128 num, uint128 den, uint64 at) = actions.pendingSplit(address(s));
        assertEq(num, 2);
        assertEq(den, 1);
        assertEq(at, t0 + 10);

        // Not yet in force one second early.
        vm.warp(t0 + 9);
        actions.sync(address(s));
        assertEq(actions.splitNum(address(s)), 0);

        vm.warp(t0 + 10);
        s.setMultiplier(2e18); // the split doubles the multiplier: no income
        vm.expectEmit(address(actions));
        emit ActionEngine.SplitApplied(address(s), 2, 1);
        (, uint256 j) = actions.sync(address(s));
        assertEq(j, 1e36);
        assertEq(actions.checkpointCount(address(s)), 1);
        assertEq(actions.splitNum(address(s)), 2);
        assertEq(actions.splitDen(address(s)), 1);
        (,, at) = actions.pendingSplit(address(s));
        assertEq(at, 0);

        // A second split (1:3) compounds the factors; income after it still books.
        vm.prank(keeper);
        actions.scheduleSplit(address(s), 1, 3, uint64(t0 + 20));
        vm.warp(t0 + 20);
        s.setMultiplier(uint256(2e18) / 3);
        actions.sync(address(s));
        assertEq(actions.splitNum(address(s)), 2);
        assertEq(actions.splitDen(address(s)), 3);
        vm.warp(t0 + 30);
        uint256 m = uint256(2e18) / 3 * 101 / 100;
        s.setMultiplier(m);
        (, j) = actions.sync(address(s));
        assertEq(j, uint256(1e36) * 1e18 / (m * 3 / 2), "1% income books");
        assertEq(actions.checkpointCount(address(s)), 2);
    }

    function test_actions_incomePauseFreezesAndExpires() public {
        MockStock s = _fresh();
        vm.expectEmit(address(actions));
        emit ActionEngine.IncomePaused(address(s), true);
        vm.prank(keeper);
        actions.setIncomePaused(address(s), true);
        assertEq(actions.incomePausedUntil(address(s)), t0 + 3 days);
        assertTrue(actions.incomePaused(address(s)));

        vm.warp(t0 + 1 hours);
        s.setMultiplier(1.01e18);
        (uint256 ts, uint256 j) = actions.sync(address(s));
        assertEq(ts, t0);
        assertEq(j, 1e36);
        assertEq(actions.checkpointCount(address(s)), 1);

        vm.warp(t0 + 3 days - 1);
        assertTrue(actions.incomePaused(address(s)));
        vm.warp(t0 + 3 days);
        assertFalse(actions.incomePaused(address(s)));
        (ts, j) = actions.sync(address(s));
        assertEq(ts, t0 + 3 days);
        assertEq(j, uint256(1e36) * 1e18 / 1.01e18);

        vm.prank(keeper);
        actions.setIncomePaused(address(s), true);
        vm.prank(keeper);
        actions.setIncomePaused(address(s), false);
        assertEq(actions.incomePausedUntil(address(s)), 0);
    }

    function test_actions_largeStepHeldUntilConfirmed() public {
        MockStock s = _fresh();
        vm.warp(t0 + 1);
        s.setMultiplier(1.06e18); // > 5% in one sync
        uint256 held = uint256(1e36) * 1e18 / 1.06e18;
        vm.expectEmit(address(actions));
        emit ActionEngine.StepHeld(address(s), 1e36, held);
        (uint256 ts, uint256 j) = actions.sync(address(s));
        assertEq(ts, t0);
        assertEq(j, 1e36);

        vm.expectEmit(address(actions));
        emit ActionEngine.StepConfirmed(address(s));
        vm.prank(keeper);
        actions.confirmStep(address(s));
        assertEq(actions.stepConfirmedUntil(address(s)), t0 + 1 + 1 days);

        vm.warp(t0 + 2);
        vm.expectEmit(address(actions));
        emit ActionEngine.IndexUpdated(address(s), t0 + 2, held);
        (ts, j) = actions.sync(address(s));
        assertEq(ts, t0 + 2);
        assertEq(j, held);
        assertEq(actions.stepConfirmedUntil(address(s)), 0, "a confirmation is used once");
    }

    function test_actions_stepBoundaryAtFivePercent() public {
        MockStock s = _fresh();
        vm.warp(t0 + 1);
        // j just below 95% of the last index is held; just above it books.
        s.setMultiplier(1052631578947368422);
        (, uint256 j) = actions.sync(address(s));
        assertEq(j, 1e36, "held");
        s.setMultiplier(1052631578947368421);
        (, j) = actions.sync(address(s));
        assertEq(j, uint256(1e54) / 1052631578947368421, "booked");
        assertEq(actions.checkpointCount(address(s)), 2);
    }

    // =============================================================== Round 2: survivor triage
    // (every surviving mutant classified; real gaps closed here). Time constants are written as literals
    // here, so a mutated constant cannot move the test's own expectation with it.

    function test_actions_exactFivePercentBooksAndHeldEventCarriesLastIndex() public {
        // base 0.95e18 -> 1e18 is a step to exactly 95% of the last index: booked, not held.
        MockStock s = new MockStock();
        s.setMultiplier(0.95e18);
        vm.prank(gov);
        gate.register(address(s), AssetGate.Class.STOCK8056, 31, 7);
        actions.sync(address(s));
        vm.warp(t0 + 1);
        s.setMultiplier(1e18);
        (, uint256 j) = actions.sync(address(s));
        assertEq(j, 95e34, "exactly 5% books");

        // With two checkpoints, StepHeld reports the newest index (the monitor alerts on it).
        vm.warp(t0 + 2);
        s.setMultiplier(1.2e18);
        vm.expectEmit(address(actions));
        emit ActionEngine.StepHeld(address(s), 95e34, uint256(1e36) * 0.95e18 / 1.2e18);
        actions.sync(address(s));
    }

    function test_actions_expiredConfirmationIsLeftAlone() public {
        MockStock s = _fresh();
        vm.prank(keeper);
        actions.confirmStep(address(s));
        vm.warp(t0 + 1 days + 1);
        s.setMultiplier(1.01e18); // a small step books without the (expired) confirmation
        actions.sync(address(s));
        assertEq(actions.checkpointCount(address(s)), 2);
        assertEq(actions.stepConfirmedUntil(address(s)), t0 + 1 days, "only a used confirmation is cleared");
    }

    function test_actions_treasuryHasNoMultiplier() public {
        MockStock s = new MockStock();
        s.setMultiplier(2e18); // ignored: TREASURY assets carry no income multiplier
        vm.prank(gov);
        gate.register(address(s), AssetGate.Class.TREASURY, 3, 0);
        assertEq(actions.multiplier(address(s)), 1e18);
    }

    function test_actions_pausedNewAssetStillGetsFirstCheckpoint() public {
        MockStock s = new MockStock();
        vm.prank(gov);
        gate.register(address(s), AssetGate.Class.STOCK8056, 31, 7);
        vm.prank(keeper);
        actions.setIncomePaused(address(s), true);
        (uint256 ts, uint256 j) = actions.sync(address(s));
        assertEq(ts, t0);
        assertEq(j, 1e36);
        assertEq(actions.checkpointCount(address(s)), 1);
    }

    function test_actions_lateSyncAppliesSplitAndSplitMayStartNow() public {
        MockStock s = _fresh();
        vm.prank(keeper);
        actions.scheduleSplit(address(s), 2, 1, uint64(t0 + 10));
        vm.warp(t0 + 15); // first sync after `at`, not at it
        s.setMultiplier(2e18);
        (, uint256 j) = actions.sync(address(s));
        assertEq(actions.splitNum(address(s)), 2);
        assertEq(j, 1e36);

        // `at` may be now.
        vm.prank(keeper);
        actions.scheduleSplit(address(s), 3, 1, uint64(block.timestamp));
        (,, uint64 at) = actions.pendingSplit(address(s));
        assertEq(at, block.timestamp);
    }

    function test_bundle_syncsBeforeReadingIndexAndSkipsZeroFee() public {
        _depositAndClear(1000);
        // Income since the last checkpoint that nobody synced: unbundle must sync first.
        stock.setMultiplier(1.01e18);
        uint256 j1 = uint256(1e36) * 1e18 / 1.01e18;
        BundleVerifier.Unbundle memory u;
        u.root = pool.currentRoot();
        u.now_ = block.timestamp;
        u.asset = address(stock);
        u.nullifiers[0] = _next();
        bytes32[] memory p = new bytes32[](12);
        (p[0], p[1], p[2], p[3], p[4], p[5]) = (_b(u.root), _b(u.now_), _a(address(stock)), _b(j1), _b(u.now_), _b(31));
        p[6] = _b(u.nullifiers[0]);
        v.expect(p);
        bundler.unbundle("", u);

        // Same for bundle; a zero fee books nothing.
        vm.warp(block.timestamp + 1);
        stock.setMultiplier(1.02e18);
        BundleVerifier.Bundle memory b;
        b.root = pool.currentRoot();
        b.now_ = block.timestamp;
        b.asset = address(stock);
        b.nullifier = _next();
        p = new bytes32[](12);
        (p[0], p[1], p[2], p[3]) = (_b(b.root), _b(b.now_), _a(address(stock)), _b(uint256(1e36) * 1e18 / 1.02e18));
        (p[4], p[6]) = (_b(31), _b(b.nullifier));
        v.expect(p);
        vm.recordLogs();
        bundler.bundle("", b);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != CordonPool.FeeCredited.selector, "no zero fee credit");
        }
    }

    function test_bundle_proofAgeClaimEndAndPause() public {
        BundleVerifier.Term memory t;
        t.root = pool.currentRoot();
        t.now_ = block.timestamp - 1 hours; // oldest accepted
        t.nullifier = _next();
        bundler.term("", t);
        t.now_ = block.timestamp - 1 hours - 1;
        t.nullifier = _next();
        vm.expectRevert(BundleVerifier.StaleProof.selector);
        bundler.term("", t);

        // A claim may end in the past, not in the future.
        vm.warp(t0 + 100);
        BundleVerifier.Claim memory c;
        c.root = pool.currentRoot();
        c.asset = address(stock);
        c.tStart = t0;
        c.tEnd = t0 + 50;
        c.nullifier = _next();
        bundler.claimIncome("", c);
        c.tEnd = block.timestamp + 1;
        c.nullifier = _next();
        vm.expectRevert(BundleVerifier.StaleProof.selector);
        bundler.claimIncome("", c);

        // Bundling pause (bit 2) stops bundle.
        vm.prank(guardian);
        control.pause(2);
        BundleVerifier.Bundle memory b;
        b.root = pool.currentRoot();
        b.now_ = block.timestamp;
        b.asset = address(stock);
        b.nullifier = _next();
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, 2));
        bundler.bundle("", b);
    }

    function test_pool_standbyAndProofAgeLiterals() public {
        uint256 npk = _next();
        uint256 commit = _depositCommit(npk, 100);
        vm.expectEmit(address(pool));
        emit CordonPool.Deposited(0, address(stock), 100, commit, block.timestamp + 15 minutes);
        vm.prank(alice);
        uint256 id = pool.deposit(address(stock), 100, npk);
        vm.warp(block.timestamp + 15 minutes - 1);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.InStandby.selector, id));
        pool.clear(_one(id));
        vm.warp(block.timestamp + 1);
        pool.clear(_one(id));

        CordonPool.Transfer memory t;
        t.root = pool.currentRoot();
        t.now_ = block.timestamp - 1 hours; // oldest accepted
        t.nullifiers = [_next(), _next()];
        pool.transact("", t);
        t.now_ = block.timestamp - 1 hours - 1;
        t.nullifiers = [_next(), _next()];
        vm.expectRevert(CordonPool.StaleProof.selector);
        pool.transact("", t);
    }

    function test_dvp_proofAgeLiteral() public {
        vm.warp(block.timestamp + 1 hours);
        DvPSettler.Price[16] memory pr;
        DvPSettler.Trade[] memory none = new DvPSettler.Trade[](0);
        vm.prank(sequencer);
        settler.submitBatch(block.timestamp - 5 minutes, pr, none); // oldest accepted
        vm.prank(sequencer);
        vm.expectRevert(DvPSettler.StaleProof.selector);
        settler.submitBatch(block.timestamp - 5 minutes - 1, pr, none);
    }

    function test_enc_templateBitIsPerKind() public {
        uint64 until = uint64(block.timestamp + 1 days);
        vm.prank(gov);
        gate.setTemplates(address(stock), 4); // LIEN only
        this.encumberExt(2, until);
        vm.prank(gov);
        gate.setTemplates(address(stock), 1); // LOCKUP only
        vm.expectRevert(abi.encodeWithSelector(EncumbranceRegistry.TemplateNotAllowed.selector, address(stock), 1));
        this.encumberExt(1, until);
    }

    function test_nav_epochLiabilitiesAndHoldingOrder() public {
        NavAttestor.Attestation memory a;
        a.epoch = 1;
        a.navPerShare18 = 1e18;
        a.totalShares = 1;
        a.queueUsdg = 5e6;
        a.liabilities = 5e6 * 1e21 + 1; // more than the queue: allowed
        a.root = pool.currentRoot();
        (a.nullifiers[0], a.nullifiers[1]) = (900, 800); // distinct holdings in any order
        NavAttestor.Price[16] memory pr;
        vm.prank(manager);
        nav.attest(VAULT, a, pr, "");
        uint256 t1 = block.timestamp;
        (, uint256 estClear) = nav.redeemQueue(VAULT);
        assertEq(estClear, t1 + 1 hours);

        a.epoch = 2;
        vm.warp(t1 + 1 hours - 1);
        vm.prank(manager);
        vm.expectRevert(NavAttestor.TooEarly.selector);
        nav.attest(VAULT, a, pr, "");
        vm.warp(t1 + 1 hours + 1); // any time after one epoch
        vm.prank(manager);
        nav.attest(VAULT, a, pr, "");

        a.epoch = 3;
        a.liabilities = 5e6 * 1e21 - 1;
        vm.warp(block.timestamp + 2 hours);
        vm.prank(manager);
        vm.expectRevert(NavAttestor.LiabilityOmitted.selector);
        nav.attest(VAULT, a, pr, "");
    }

    function test_screening_flagEmits() public {
        vm.expectEmit(address(screening));
        emit ScreeningGate.Flagged(7);
        vm.prank(keeper);
        screening.flag(7);
        assertTrue(screening.flagged(7));
    }

    function test_solvency_lateAttestIsFine() public {
        _deposit(1000);
        solvency.attest(address(stock));
        vm.warp(block.timestamp + 1 hours + 5);
        assertEq(solvency.attest(address(stock)).epoch, 2);
    }

    function test_staking_talliesAddUpAndLocksEnd() public {
        address carol = makeAddr("carol");
        address dave = makeAddr("dave");
        _stake(alice, 1000);
        _stake(bob, 3000);
        _stake(carol, 1000);
        _stake(dave, 3000);
        uint256 t1 = block.timestamp;
        vm.expectEmit(address(staking));
        emit CrdnStaking.Proposed(0, CrdnStaking.Subject.TEMPLATE, keccak256("z"), uint64(t1 + 5 days));
        vm.prank(alice);
        uint256 id = staking.propose(CrdnStaking.Subject.TEMPLATE, keccak256("z"));
        address[4] memory who = [alice, bob, carol, dave];
        for (uint256 i; i < 4; ++i) {
            vm.prank(who[i]);
            staking.vote(id, i < 2);
        }
        (,,, uint256 forV, uint256 againstV) = staking.proposals(id);
        assertEq(forV, 4000);
        assertEq(againstV, 4000);

        // Closed for good after its end, not just at it; a lock that ended stays ended.
        vm.warp(t1 + 5 days + 1);
        vm.prank(alice);
        vm.expectRevert(CrdnStaking.VotingClosed.selector);
        staking.vote(id, true);
        vm.warp(t1 + 8 days);
        vm.prank(alice);
        staking.unstake(1000);
        assertEq(crdn.balanceOf(alice), 1000);
    }

    function test_staking_rewardsAccumulateAndTokensListOnce() public {
        _stake(alice, 1000);
        _stake(bob, 3000);
        stock.mint(address(staking), 10_000); // stakers' 5% = 500
        staking.distribute(address(stock));
        vm.prank(alice);
        staking.stake(0); // settles alice: 125
        stock.mint(address(staking), 20_000); // stakers' 5% = 1000
        staking.distribute(address(stock));
        vm.prank(alice);
        staking.stake(0); // settles again: owed adds up
        assertEq(staking.owed(address(stock), alice), 375);
        assertEq(staking.accPerStake(address(stock)), uint256(1500) * 1e36 / 4000);
        assertEq(staking.booked(address(stock)), 1500);

        vm.prank(alice);
        staking.claim(address(stock));
        assertEq(stock.balanceOf(alice), 1e24 + 375);
        assertEq(staking.booked(address(stock)), 1125, "bob's share stays booked");
        assertEq(staking.feeTokens(0), address(stock));
        vm.expectRevert();
        staking.feeTokens(1); // listed once, however often it is distributed
    }

    function test_staking_nothingFreshEmitsNothing() public {
        vm.prank(gov);
        control.setFeeRecipient(address(staking));
        _stake(alice, 1000);
        _fund(bob, 1);
        vm.recordLogs();
        vm.prank(bob);
        staking.stake(1); // the pool holds no fees and nothing new arrived
        staking.distribute(address(stock));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != CrdnStaking.FeesDistributed.selector, "no empty split");
            assertTrue(logs[i].topics[0] != CordonPool.FeesCollected.selector, "no empty collect");
        }
    }

    function test_staking_dustSkipsZeroTransfers() public {
        // 9 units: treasury floor(0.9) = 0 and burn 0 are skipped (some tokens refuse 0-transfers).
        stock.mint(address(staking), 9);
        vm.recordLogs();
        staking.distribute(address(stock));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 transfers;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")) ++transfers;
        }
        assertEq(transfers, 1, "workers only");
        assertEq(stock.balanceOf(workers), 9);
    }

    function test_staking_lockFollowsSenderNotOrigin() public {
        _stake(alice, 1000);
        // bob stakes in the same block from a transaction alice signed (e.g. through a wallet contract).
        _fund(bob, 1000);
        vm.prank(bob, alice);
        staking.stake(1000);
        assertEq(staking.lockedUntil(bob), block.timestamp + 7 days);
    }
}
