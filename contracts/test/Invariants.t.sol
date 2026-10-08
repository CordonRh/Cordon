// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {CrdnStaking} from "../src/CrdnStaking.sol";
import {EncumbranceRegistry} from "../src/EncumbranceRegistry.sol";
import {ScreeningGate} from "../src/ScreeningGate.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {MockStock} from "./Base.t.sol";

// Stateful invariant suites, one per fund-holding module. Proofs are stubbed with an
// always-true verifier, so the handlers stand in for the circuits: they only ever spend
// what the ghost ledger says is in the tree. Runs x depth come from foundry.toml
// ([invariant] runs = 256, depth = 500: 128,000 calls per invariant).

uint256 constant P_FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// Note: keccak stand-in for Poseidon2. The invariants are about accounting, not the
/// hash, and 32 real Poseidon2 calls per leaf would dominate a 128k-call campaign.
contract MockHasher is IPoseidon2 {
    function hash_1(uint256 x) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(x))) % P_FIELD;
    }

    function hash_2(uint256 x, uint256 y) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(x, y))) % P_FIELD;
    }

    function hash_3(uint256 x, uint256 y, uint256 z) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(x, y, z))) % P_FIELD;
    }
}

/// Shared fuzz helpers: fresh field elements and a known root to prove against.
abstract contract FieldHandler is Test {
    uint256 internal salt;

    function _fresh() internal returns (uint256) {
        return uint256(keccak256(abi.encode(address(this), salt++))) % (P_FIELD - 1) + 1;
    }

    /// One in four output slots is empty (commit 0, no leaf).
    function _commit(uint256 seed) internal returns (uint256) {
        return seed % 4 == 0 ? 0 : _fresh();
    }

    function _root(CordonPool pool, uint256 seed) internal view returns (uint256) {
        uint256 r = pool.roots(seed % pool.ROOT_HISTORY());
        return pool.isKnownRoot(r) ? r : pool.currentRoot();
    }
}

abstract contract InvariantBase is Test {
    address internal gov = makeAddr("timelock");
    address internal feeSink = makeAddr("staking");
    CordonControl internal control;
    AssetGate internal gate;
    ScreeningGate internal screening;
    CordonPool internal pool;

    function _deployPool() internal {
        vm.warp(1_800_000_000);
        control = new CordonControl(gov, makeAddr("guardian"), feeSink);
        gate = new AssetGate(gov);
        screening = new ScreeningGate(control);
        pool = new CordonPool(new MockHasher(), gate, control, screening, IProofVerifier(address(new MockVerifier())));
    }

    function _listed() internal returns (MockStock s) {
        s = new MockStock();
        vm.startPrank(gov);
        gate.register(address(s), AssetGate.Class.STOCK8056, gate.ALL_CLAIMS(), gate.ALL_TEMPLATES());
        vm.stopPrank();
    }

    function _grant(address who) internal {
        vm.startPrank(gov);
        control.setEngine(who, true);
        control.setKeeper(who, true);
        vm.stopPrank();
    }

    function _target(address handler, bytes4[] memory selectors) internal {
        targetContract(handler);
        targetSelector(FuzzSelector({addr: handler, selectors: selectors}));
    }
}

// =================================================================== a. CordonPool

contract PoolHandler is FieldHandler {
    CordonPool internal pool;
    ScreeningGate internal screening;
    MockStock[3] internal assets;
    address[4] internal actors;

    uint256[] internal pending; // deposit ids not yet settled
    uint256[] public spent;
    mapping(address => uint256) public ghostPending; // raw in standby
    mapping(address => uint256) public ghostInTree; // raw backing notes in the tree
    mapping(address => uint256) public ghostFees;
    mapping(address => uint256) public ghostDonated; // sent to the pool outside any deposit
    uint256 public ghostLeaves;
    uint256 public doubleSpends;

    constructor(CordonPool pool_, ScreeningGate screening_, MockStock[3] memory assets_) {
        pool = pool_;
        screening = screening_;
        assets = assets_;
        actors = [makeAddr("p0"), makeAddr("p1"), makeAddr("p2"), makeAddr("p3")];
    }

    function deposit(uint256 actorSeed, uint256 assetSeed, uint256 raw, uint256 npk) external {
        address a = actors[actorSeed % 4];
        MockStock t = assets[assetSeed % 3];
        raw = bound(raw, 1, 1e30);
        t.mint(a, raw);
        vm.startPrank(a);
        t.approve(address(pool), raw);
        pending.push(pool.deposit(address(t), raw, bound(npk, 0, P_FIELD - 1)));
        vm.stopPrank();
        ghostPending[address(t)] += raw;
    }

    function flag(uint256 seed) external {
        if (pending.length == 0) return;
        screening.flag(pending[seed % pending.length]); // handler is a keeper
    }

    /// Clears up to 8 unflagged pending deposits after the standby.
    function clear(uint256 seed) external {
        vm.warp(block.timestamp + pool.STANDBY());
        uint256[] memory ids = new uint256[](pending.length);
        uint256 k;
        uint256 max = 1 + seed % 8;
        for (uint256 i = pending.length; i > 0 && k < max; --i) {
            uint256 id = pending[i - 1];
            if (screening.flagged(id)) continue;
            ids[k++] = id;
            (, address asset, uint128 raw,,,) = pool.deposits(id);
            ghostPending[asset] -= raw;
            ghostInTree[asset] += raw;
            ++ghostLeaves;
            _drop(i - 1);
        }
        assembly {
            mstore(ids, k)
        }
        pool.clear(ids);
    }

    function unshield(uint256 seed) external {
        if (pending.length == 0) return;
        uint256 i = seed % pending.length;
        uint256 id = pending[i];
        (address origin, address asset, uint128 raw,,,) = pool.deposits(id);
        vm.prank(origin);
        pool.unshieldToOrigin(id);
        ghostPending[asset] -= raw;
        _drop(i);
    }

    /// Join-split; `withdraw` releases up to what the tree holds of the asset.
    function transact(uint256 assetSeed, uint256 raw, uint256 seed, bool withdraw) external {
        address t = address(assets[assetSeed % 3]);
        uint256 avail = ghostInTree[t];
        raw = withdraw && avail != 0 ? bound(raw, 1, avail) : 0;
        CordonPool.Transfer memory tr = _transfer(t, raw, seed);
        tr.nullifiers = [_fresh(), _fresh()];
        pool.transact("", tr);
        spent.push(tr.nullifiers[0]);
        spent.push(tr.nullifiers[1]);
        ghostInTree[t] -= raw;
        if (tr.commits[0] != 0) ++ghostLeaves;
        if (tr.commits[1] != 0) ++ghostLeaves;
    }

    /// Replays a spent nullifier through transact or applyOp; success is a violation.
    function doubleSpend(uint256 seed, bool viaEngine) external {
        if (spent.length == 0) return;
        uint256 n = spent[seed % spent.length];
        if (viaEngine) {
            uint256[] memory ns = new uint256[](1);
            ns[0] = n;
            try pool.applyOp(_root(pool, seed), ns, new uint256[](0)) {
                ++doubleSpends;
            } catch {}
        } else {
            CordonPool.Transfer memory tr = _transfer(address(assets[seed % 3]), 0, seed);
            tr.nullifiers = [_fresh(), n];
            try pool.transact("", tr) {
                ++doubleSpends;
            } catch {}
        }
    }

    function applyOp(uint256 seed, uint256 nNull, uint256 nCommit) external {
        uint256[] memory ns = new uint256[](bound(nNull, 0, 4));
        for (uint256 i; i < ns.length; ++i) {
            ns[i] = (seed >> (i * 8)) % 5 == 0 ? 0 : _fresh(); // masked slots
        }
        uint256[] memory cs = new uint256[](bound(nCommit, 0, 5));
        for (uint256 i; i < cs.length; ++i) {
            cs[i] = _commit(seed >> (64 + i * 8));
        }
        pool.applyOp(_root(pool, seed), ns, cs); // handler is an engine
        for (uint256 i; i < ns.length; ++i) {
            if (ns[i] != 0) spent.push(ns[i]);
        }
        for (uint256 i; i < cs.length; ++i) {
            if (cs[i] != 0) ++ghostLeaves;
        }
    }

    function creditFee(uint256 assetSeed, uint256 raw) external {
        address t = address(assets[assetSeed % 3]);
        raw = bound(raw, 0, ghostInTree[t]);
        pool.creditFee(t, raw);
        ghostInTree[t] -= raw;
        ghostFees[t] += raw;
    }

    function collectFees(uint256 assetSeed) external {
        address t = address(assets[assetSeed % 3]);
        pool.collectFees(t);
        ghostFees[t] = 0;
    }

    function donate(uint256 assetSeed, uint256 raw) external {
        MockStock t = assets[assetSeed % 3];
        raw = bound(raw, 1, 1e24);
        t.mint(address(pool), raw);
        ghostDonated[address(t)] += raw;
    }

    function spentCount() external view returns (uint256) {
        return spent.length;
    }

    function _transfer(address asset, uint256 raw, uint256 seed) internal returns (CordonPool.Transfer memory tr) {
        tr.root = _root(pool, seed);
        tr.now_ = block.timestamp - bound(uint256(keccak256(abi.encode(seed))), 0, pool.MAX_PROOF_AGE());
        tr.asset = asset;
        tr.withdrawRaw = raw;
        tr.recipient = actors[(seed >> 16) % 4];
        tr.commits = [_commit(seed >> 24), _commit(seed >> 32)];
    }

    function _drop(uint256 i) internal {
        pending[i] = pending[pending.length - 1];
        pending.pop();
    }
}

contract PoolInvariants is InvariantBase {
    PoolHandler internal h;
    MockStock[3] internal assets;

    function setUp() public {
        _deployPool();
        for (uint256 i; i < 3; ++i) {
            assets[i] = _listed();
        }
        h = new PoolHandler(pool, screening, assets);
        _grant(address(h));
        bytes4[] memory s = new bytes4[](10);
        s[0] = PoolHandler.deposit.selector;
        s[1] = PoolHandler.flag.selector;
        s[2] = PoolHandler.clear.selector;
        s[3] = PoolHandler.unshield.selector;
        s[4] = PoolHandler.transact.selector;
        s[5] = PoolHandler.doubleSpend.selector;
        s[6] = PoolHandler.applyOp.selector;
        s[7] = PoolHandler.creditFee.selector;
        s[8] = PoolHandler.collectFees.selector;
        s[9] = PoolHandler.donate.selector;
        _target(address(h), s);
    }

    /// Solvency: the pool always holds what it owes to notes, pending deposits and fees.
    function invariant_poolSolvent() public view {
        for (uint256 i; i < 3; ++i) {
            address a = address(assets[i]);
            assertGe(MockStock(a).balanceOf(address(pool)), pool.owed(a) + pool.fees(a), "insolvent");
        }
    }

    /// owed = pending + in-tree, fees = credited - collected, balance = owed + fees + donations.
    function invariant_poolLedgerExact() public view {
        for (uint256 i; i < 3; ++i) {
            address a = address(assets[i]);
            assertEq(pool.owed(a), h.ghostPending(a) + h.ghostInTree(a), "owed");
            assertEq(pool.fees(a), h.ghostFees(a), "fees");
            assertEq(
                MockStock(a).balanceOf(address(pool)), pool.owed(a) + pool.fees(a) + h.ghostDonated(a), "balance"
            );
        }
    }

    /// A spent nullifier never spends again (replays are attempted by `doubleSpend`).
    function invariant_nullifierSpentOnce() public view {
        assertEq(h.doubleSpends(), 0, "double spend");
        uint256 n = h.spentCount();
        if (n != 0) assertTrue(pool.nullified(h.spent(n - 1)), "last spend recorded");
    }

    function invariant_leafCountMatchesInserts() public view {
        assertEq(pool.nextLeaf(), h.ghostLeaves());
    }

    function invariant_currentRootKnown() public view {
        assertTrue(pool.isKnownRoot(pool.currentRoot()), "current root unknown");
        assertFalse(pool.isKnownRoot(0), "zero root known");
    }

    /// Full sweep once per run: every nullifier the handler spent is marked.
    function afterInvariant() public view {
        uint256 n = h.spentCount();
        for (uint256 i; i < n; ++i) {
            assertTrue(pool.nullified(h.spent(i)), "spent nullifier not marked");
        }
    }
}

// =================================================================== b. ActionEngine

contract ActionHandler is Test {
    ActionEngine internal actions;
    MockStock internal stock;
    uint256 public m = 1e18;
    uint256 public splits;
    uint256 public monotoneViolations;
    uint256 public timeViolations;
    uint256 public pausedViolations;

    constructor(ActionEngine actions_, MockStock stock_) {
        actions = actions_;
        stock = stock_;
    }

    /// Moves the multiplier by up to +-20% (anything past 5% is held until resolved).
    function move(int256 stepBps) external {
        int256 s = bound(stepBps, -2000, 2000);
        uint256 next = m * uint256(10_000 + s) / 10_000;
        if (next < 1e15 || next > 1e24) return;
        m = next;
        stock.setMultiplier(next);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 1 days));
    }

    function sync() external {
        address a = address(stock);
        uint256 n0 = actions.checkpointCount(a);
        (uint256 t0, uint256 j0) = actions.latest(a);
        bool paused = actions.incomePaused(a);
        actions.sync(a);
        uint256 n1 = actions.checkpointCount(a);
        (uint256 t1, uint256 j1) = actions.latest(a);
        if (paused && (n1 != n0 || t1 != t0 || j1 != j0)) ++pausedViolations;
        if (j1 > j0) ++monotoneViolations;
        if (n1 == n0) {
            if (t1 != t0) ++timeViolations; // only the same-second checkpoint is rewritten
        } else if (n1 == n0 + 1) {
            if (t1 <= t0) ++timeViolations;
            if (j1 >= j0) ++monotoneViolations;
        } else {
            ++timeViolations;
        }
    }

    function confirmStep() external {
        actions.confirmStep(address(stock));
    }

    /// At most 20 splits of up to 3:1 / 1:3, so the cumulative factor stays in range.
    function scheduleSplit(uint256 num, uint256 den, uint256 delay) external {
        (,, uint64 at) = actions.pendingSplit(address(stock));
        if (at != 0 || splits >= 20) return;
        ++splits;
        actions.scheduleSplit(
            address(stock),
            uint128(bound(num, 1, 3)),
            uint128(bound(den, 1, 3)),
            uint64(block.timestamp + bound(delay, 0, 2 days))
        );
    }

    function setIncomePaused(bool paused) external {
        actions.setIncomePaused(address(stock), paused);
    }
}

contract ActionEngineInvariants is InvariantBase {
    ActionEngine internal actions;
    MockStock internal stock;
    ActionHandler internal h;

    function setUp() public {
        _deployPool();
        actions = new ActionEngine(gate, control);
        stock = _listed();
        actions.sync(address(stock));
        h = new ActionHandler(actions, stock);
        _grant(address(h));
        bytes4[] memory s = new bytes4[](6);
        s[0] = ActionHandler.move.selector;
        s[1] = ActionHandler.warp.selector;
        s[2] = ActionHandler.sync.selector;
        s[3] = ActionHandler.confirmStep.selector;
        s[4] = ActionHandler.scheduleSplit.selector;
        s[5] = ActionHandler.setIncomePaused.selector;
        _target(address(h), s);
    }

    function invariant_indexNeverRises() public view {
        assertEq(h.monotoneViolations(), 0, "j rose");
        (, uint256 j) = actions.latest(address(stock));
        assertLe(j, actions.J_SCALE());
    }

    function invariant_checkpointTimesIncrease() public view {
        assertEq(h.timeViolations(), 0, "checkpoint time");
        (uint256 ts,) = actions.latest(address(stock));
        assertLe(ts, block.timestamp);
    }

    function invariant_pausedIndexFrozen() public view {
        assertEq(h.pausedViolations(), 0, "index moved while paused");
    }

    /// Walks the whole history once per run: ts strictly up, j strictly down.
    function afterInvariant() public view {
        address a = address(stock);
        (uint256 ts, uint256 j) = actions.latest(a);
        uint256 n = 1;
        while (true) {
            try actions.checkpointAt(a, ts - 1) returns (uint256 pts, uint256 pj) {
                assertLt(pts, ts, "ts order");
                assertGt(pj, j, "j order");
                (ts, j) = (pts, pj);
                ++n;
            } catch {
                break;
            }
        }
        assertEq(n, actions.checkpointCount(a), "walk length");
        // The first checkpoint is 1e36 unless a same-second sync rewrote it lower.
        assertLe(j, actions.J_SCALE(), "first checkpoint");
    }
}

// =================================================================== c. CrdnStaking

contract StakingHandler is Test {
    CrdnStaking internal staking;
    MockStock internal crdn;
    MockStock internal fee;
    address[4] internal actors;
    uint256 public feesIn;
    uint256 public claimed;

    constructor(CrdnStaking staking_, MockStock crdn_, MockStock fee_) {
        staking = staking_;
        crdn = crdn_;
        fee = fee_;
        actors = [makeAddr("s0"), makeAddr("s1"), makeAddr("s2"), makeAddr("s3")];
    }

    function stake(uint256 who, uint256 amount) external {
        address a = actors[who % 4];
        amount = bound(amount, 1, 1e24);
        crdn.mint(a, amount);
        vm.startPrank(a);
        crdn.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    /// Waits out the lock first, so unstake is exercised rather than reverting.
    function unstake(uint256 who, uint256 amount) external {
        address a = actors[who % 4];
        uint256 s = staking.staked(a);
        if (s == 0) return;
        uint64 until = staking.lockedUntil(a);
        if (block.timestamp < until) vm.warp(until);
        vm.prank(a);
        staking.unstake(bound(amount, 1, s));
    }

    function addFees(uint256 amount) external {
        amount = bound(amount, 0, 1e24);
        fee.mint(address(staking), amount);
        feesIn += amount;
    }

    function distribute() external {
        staking.distribute(address(fee));
    }

    function claim(uint256 who) external {
        address a = actors[who % 4];
        uint256 before = fee.balanceOf(a);
        vm.prank(a);
        staking.claim(address(fee));
        claimed += fee.balanceOf(a) - before;
    }

    function proposeAndVote(uint256 who, bool support) external {
        address a = actors[who % 4];
        if (staking.staked(a) == 0) return;
        vm.startPrank(a);
        uint256 id = staking.propose(CrdnStaking.Subject.TEMPLATE, keccak256(abi.encode(block.timestamp, support)));
        staking.vote(id, support);
        vm.stopPrank();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 10 days));
    }

    function sumClaimable() external view returns (uint256 s) {
        for (uint256 i; i < 4; ++i) {
            s += staking.claimable(actors[i], address(fee));
        }
    }

    function sumStaked() external view returns (uint256 s) {
        for (uint256 i; i < 4; ++i) {
            s += staking.staked(actors[i]);
        }
    }
}

contract StakingInvariants is InvariantBase {
    CrdnStaking internal staking;
    MockStock internal crdn;
    MockStock internal fee;
    StakingHandler internal h;
    address internal workers = makeAddr("workers");
    address internal treasury = makeAddr("treasury");
    address internal burnSink = makeAddr("burnSink");

    function setUp() public {
        _deployPool();
        crdn = new MockStock();
        fee = _listed();
        staking = new CrdnStaking(crdn, workers, treasury, burnSink, pool);
        h = new StakingHandler(staking, crdn, fee);
        bytes4[] memory s = new bytes4[](7);
        s[0] = StakingHandler.stake.selector;
        s[1] = StakingHandler.unstake.selector;
        s[2] = StakingHandler.addFees.selector;
        s[3] = StakingHandler.distribute.selector;
        s[4] = StakingHandler.claim.selector;
        s[5] = StakingHandler.proposeAndVote.selector;
        s[6] = StakingHandler.warp.selector;
        _target(address(h), s);
    }

    function invariant_crdnBacksStake() public view {
        assertEq(crdn.balanceOf(address(staking)), staking.totalStaked(), "crdn balance");
        assertEq(staking.totalStaked(), h.sumStaked(), "sum of stakes");
    }

    /// Every fee unit is accounted for: workers + treasury + burn sink + claimed + what the
    /// contract still holds == fees sent in. What stakers can claim stays within what is
    /// booked for them (the difference is rounding dust), so workers + treasury + burn +
    /// claimable + claimed + dust == fees distributed.
    function invariant_feesConserved() public view {
        uint256 out = fee.balanceOf(workers) + fee.balanceOf(treasury) + fee.balanceOf(burnSink) + h.claimed();
        assertEq(out + fee.balanceOf(address(staking)), h.feesIn(), "conservation");
        assertLe(h.sumClaimable(), staking.booked(address(fee)), "claimable within booked");
        assertLe(out + h.sumClaimable(), h.feesIn());
    }

    function invariant_stakingCoversClaims() public view {
        assertGe(fee.balanceOf(address(staking)), h.sumClaimable());
    }
}

// =================================================================== d. EncumbranceRegistry

contract EncumbranceHandler is FieldHandler {
    EncumbranceRegistry internal reg;
    CordonPool internal pool;
    address internal asset;

    uint256[] public encs;
    mapping(uint256 => uint256) public secretOf;
    uint256 public violations;

    constructor(EncumbranceRegistry reg_, address asset_) {
        reg = reg_;
        pool = reg_.pool();
        asset = asset_;
    }

    function encumber(uint256 kindSeed, uint256 until, uint256 secret) external {
        if (encs.length >= 32) return; // invariants sweep every encumbrance after each call
        secret = bound(secret, 1, P_FIELD - 2);
        uint256 enc = _fresh();
        reg.encumber(
            "",
            EncumbranceRegistry.Encumber(
                pool.currentRoot(),
                asset,
                uint8(kindSeed % 3),
                uint64(block.timestamp + bound(until, 0, 30 days)),
                pool.hasher().hash_1(secret),
                _fresh(),
                _fresh(),
                enc
            )
        );
        encs.push(enc);
        secretOf[enc] = secret;
    }

    function release(uint256 seed, bool right) external {
        if (encs.length == 0) return;
        uint256 enc = encs[seed % encs.length];
        (,, bool defaulted, bool enforced) = _state(enc);
        try reg.release(enc, right ? secretOf[enc] : secretOf[enc] + 1) {
            if (!right || defaulted || enforced) ++violations;
        } catch {}
    }

    function declareDefault(uint256 seed) external {
        if (encs.length == 0) return;
        uint256 enc = encs[seed % encs.length];
        (uint8 kind, bool released,, bool enforced) = _state(enc);
        try reg.declareDefault(enc) {
            if (kind == reg.LOCKUP() || released || enforced) ++violations;
        } catch {}
    }

    function unlock(uint256 seed) external {
        if (encs.length == 0) return;
        uint256 enc = encs[seed % encs.length];
        (,,, bool enforced) = _state(enc);
        bool wasReleased = reg.isReleased(enc);
        uint256[] memory cs = new uint256[](1);
        cs[0] = _fresh();
        try reg.unlock("", EncumbranceRegistry.Spend(pool.currentRoot(), enc, _fresh(), cs)) {
            if (enforced || !wasReleased) ++violations;
        } catch {}
    }

    function enforce(uint256 seed) external {
        if (encs.length == 0) return;
        uint256 enc = encs[seed % encs.length];
        (, bool released, bool defaulted, bool enforced) = _state(enc);
        uint256[] memory cs = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            cs[i] = _fresh();
        }
        try reg.enforce("", EncumbranceRegistry.Spend(pool.currentRoot(), enc, _fresh(), cs)) {
            if (!defaulted || released || enforced) ++violations;
        } catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 10 days));
    }

    function count() external view returns (uint256) {
        return encs.length;
    }

    function _state(uint256 enc) internal view returns (uint8 kind, bool released, bool defaulted, bool enforced) {
        (, kind,,, released, defaulted, enforced,) = reg.encumbrances(enc);
    }
}

contract EncumbranceInvariants is InvariantBase {
    EncumbranceRegistry internal reg;
    EncumbranceHandler internal h;

    function setUp() public {
        _deployPool();
        address asset = address(_listed());
        IProofVerifier v = IProofVerifier(address(new MockVerifier()));
        reg = new EncumbranceRegistry(pool, v, v, v);
        _grant(address(reg));
        h = new EncumbranceHandler(reg, asset);
        _grant(address(h)); // keeper for declareDefault
        bytes4[] memory s = new bytes4[](6);
        s[0] = EncumbranceHandler.encumber.selector;
        s[1] = EncumbranceHandler.release.selector;
        s[2] = EncumbranceHandler.declareDefault.selector;
        s[3] = EncumbranceHandler.unlock.selector;
        s[4] = EncumbranceHandler.enforce.selector;
        s[5] = EncumbranceHandler.warp.selector;
        _target(address(h), s);
    }

    function invariant_releasedAndEnforcedExclusive() public view {
        uint256 n = h.count();
        for (uint256 i; i < n; ++i) {
            (,,,, bool released,, bool enforced,) = reg.encumbrances(h.encs(i));
            assertFalse(released && enforced, "released and enforced");
        }
    }

    /// enforced => defaulted; defaulted => never released; LOCKUP never defaults;
    /// an enforced note is never free to unlock.
    function invariant_stateMachine() public view {
        uint256 n = h.count();
        for (uint256 i; i < n; ++i) {
            uint256 enc = h.encs(i);
            (, uint8 kind,,, bool released, bool defaulted, bool enforced,) = reg.encumbrances(enc);
            if (enforced) assertTrue(defaulted, "enforced without default");
            if (defaulted) assertFalse(released, "defaulted and released");
            if (kind == reg.LOCKUP()) assertFalse(defaulted, "lockup defaulted");
            if (enforced) assertFalse(reg.isReleased(enc), "enforced but unlockable");
        }
    }

    /// No call ever succeeded from a state that forbids it (release after enforce or
    /// default, release with a wrong secret, unlock of an unreleased note, enforce twice).
    function invariant_noIllegalTransition() public view {
        assertEq(h.violations(), 0, "illegal transition");
        assertEq(reg.count(), h.count(), "count");
    }
}
