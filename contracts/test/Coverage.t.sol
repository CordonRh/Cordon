// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Happy paths and leftover branches the mock-verifier suites (Invariants, Negative) miss, so
// `forge coverage` over mock suites reaches every src contract. No real proofs: every
// verifier here is a mock, and the hasher is the keccak stand-in from Invariants.t.sol.

import {Test, stdStorage, StdStorage} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
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
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {IProofVerifier} from "../src/interfaces/IProofVerifier.sol";
import {MockStock} from "./Base.t.sol";
import {MockFeed, MockUsd} from "./DvPSettler.t.sol";
import {MockHasher} from "./Invariants.t.sol";
import {FlagVerifier} from "./Negative.t.sol";

/// Rejects proofs whose public input `idx` is BAD and reverts on BOOM, so one batch can
/// fail different trades at different stages.
contract KeyVerifier is IProofVerifier {
    uint256 public constant BAD = 666;
    uint256 public constant BOOM = 777;
    uint256 public immutable idx;

    constructor(uint256 idx_) {
        idx = idx_;
    }

    function verify(bytes calldata, bytes32[] calldata pub) external view returns (bool) {
        uint256 x = uint256(pub[idx]);
        require(x != BOOM, "boom");
        return x != BAD;
    }
}

/// Chainlink-style feed with any number of rounds; unknown rounds revert.
contract RoundFeed is AggregatorV3Interface {
    struct Round {
        int256 answer;
        uint256 at;
    }

    mapping(uint80 => Round) public rounds;
    uint80 public last;

    function push(int256 answer, uint256 at) external returns (uint80 id) {
        id = ++last;
        rounds[id] = Round(answer, at);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[last];
        return (last, r.answer, r.at, r.at, last);
    }

    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(id != 0 && id <= last, "No data present");
        Round memory r = rounds[id];
        return (id, r.answer, r.at, r.at, id);
    }
}

contract MockVault is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock vault", "vUSD") ERC4626(asset_) {}
}

contract CoverageTest is Test {
    using stdStorage for StdStorage;

    bytes32 internal constant VAULT = keccak256("vault");
    uint256 internal constant MEMO0 = 3 + 3 * 16 + 2 + 2 * 16; // DvP public input of memos[0]
    uint256 internal constant J1 = 1e36 * 1e18 / uint256(1.01e18); // index after a 1.01x multiplier
    uint256 internal constant J2 = 1e36 * 1e18 / uint256(1.02e18);

    address internal gov = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal sequencer = makeAddr("tee");
    address internal manager = makeAddr("manager");
    address internal workers = makeAddr("workers");
    address internal alice = makeAddr("alice");
    address internal stranger = makeAddr("stranger");

    FlagVerifier internal v;
    KeyVerifier internal orderV;
    KeyVerifier internal tradeV;
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
    uint256 internal root0;
    uint256 internal nonce = 1000;

    function setUp() public {
        vm.warp(1_800_000_000);
        t0 = block.timestamp;
        v = new FlagVerifier();
        orderV = new KeyVerifier(0); // order public input 0 = orderHash
        tradeV = new KeyVerifier(MEMO0);
        control = new CordonControl(gov, guardian, makeAddr("feeSink"));
        gate = new AssetGate(gov);
        screening = new ScreeningGate(control);
        pool = new CordonPool(new MockHasher(), gate, control, screening, v);
        actions = new ActionEngine(gate, control);
        bundler = new BundleVerifier(pool, actions, v, v, v, v);
        oracle = new PriceOracle(gov, gate);
        settler = new DvPSettler(pool, oracle, tradeV, orderV);
        registry = new EncumbranceRegistry(pool, v, v, v);
        nav = new NavAttestor(gov, pool, oracle, v);
        solvency = new SolvencyVerifier(pool);
        stock = new MockStock();
        crdn = new MockStock();
        staking = new CrdnStaking(crdn, workers, makeAddr("treasury"), makeAddr("burnSink"), pool);
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
        root0 = pool.currentRoot();
    }

    function _next() internal returns (uint256) {
        return ++nonce;
    }

    function _deposit(uint256 raw) internal returns (uint256 id) {
        vm.prank(alice);
        id = pool.deposit(address(stock), raw, _next());
    }

    function _depositAndClear(uint256 raw) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = _deposit(raw);
        vm.warp(block.timestamp + pool.STANDBY());
        pool.clear(ids);
    }

    function _one(uint256 x) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }

    function _list(address asset, AssetGate.Class c) internal {
        vm.prank(gov);
        gate.register(asset, c, 31, 7);
    }

    function _setFeed(address asset, AggregatorV3Interface f, uint32 heartbeat) internal {
        vm.prank(gov);
        oracle.setFeed(asset, f, heartbeat);
    }

    // =============================================================== NavAttestor

    /// No external call in here: it is evaluated after vm.prank / vm.expectRevert.
    function _att(uint64 epoch) internal view returns (NavAttestor.Attestation memory a) {
        a.epoch = epoch;
        a.root = root0;
    }

    function _attest(NavAttestor.Attestation memory a, NavAttestor.Price[16] memory p) internal {
        vm.prank(manager);
        nav.attest(VAULT, a, p, "");
    }

    function test_nav_registerVault_replacesManager() public {
        address m2 = makeAddr("manager2");
        vm.expectEmit(address(nav));
        emit NavAttestor.VaultRegistered(VAULT, m2, 7);
        vm.prank(gov);
        nav.registerVault(VAULT, m2, 7);
        (address m, uint256 pk,,,,,,) = nav.vaults(VAULT);
        assertEq(m, m2);
        assertEq(pk, 7);
    }

    function test_nav_attest_happyPathAndHistory() public {
        NavAttestor.Attestation memory a = _att(1);
        a.navPerShare18 = 1.05e18;
        a.totalShares = 1000e18;
        a.queueUsdg = 500e6;
        a.liabilities = 500e6 * nav.USDG_RAW_TO_USD27();
        a.holdingsRoot = 42;
        a.nullifiers[0] = _next();
        a.nullifiers[4] = _next();
        NavAttestor.Price[16] memory p;
        p[0] = NavAttestor.Price(address(stock), 1);

        vm.expectEmit(address(nav));
        emit NavAttestor.Attested(VAULT, 1, 1.05e18, 1000e18, 500e6);
        _attest(a, p);

        (address m,, uint64 epoch, uint64 ts, uint256 navps, uint256 shares, uint256 queue, uint256 hr) =
            nav.vaults(VAULT);
        assertEq(m, manager);
        assertEq(epoch, 1);
        assertEq(ts, block.timestamp);
        assertEq(navps, 1.05e18);
        assertEq(shares, 1000e18);
        assertEq(queue, 500e6);
        assertEq(hr, 42);
        (uint64 hts, uint256 hnav, uint256 hroot) = nav.history(VAULT, 1);
        assertEq(hts, block.timestamp);
        assertEq(hnav, 1.05e18);
        assertEq(hroot, 42);
        (uint256 usdg, uint256 estClear) = nav.redeemQueue(VAULT);
        assertEq(usdg, 500e6);
        assertEq(estClear, block.timestamp + nav.EPOCH());

        // Next epoch once EPOCH has passed (the TooEarly check passes with ts set).
        vm.warp(block.timestamp + nav.EPOCH());
        a.epoch = 2;
        a.navPerShare18 = 1.06e18;
        _attest(a, p);
        (, uint256 hnav2,) = nav.history(VAULT, 2);
        assertEq(hnav2, 1.06e18);
    }

    function test_nav_attest_reverts() public {
        NavAttestor.Price[16] memory p;

        vm.prank(manager);
        vm.expectRevert(NavAttestor.UnknownVault.selector);
        nav.attest(keccak256("nope"), _att(1), p, "");

        NavAttestor.Attestation memory a = _att(1);
        vm.prank(stranger);
        vm.expectRevert(NavAttestor.NotManager.selector);
        nav.attest(VAULT, a, p, "");

        vm.expectRevert(NavAttestor.WrongEpoch.selector);
        _attest(_att(2), p);

        a.queueUsdg = 1;
        a.liabilities = nav.USDG_RAW_TO_USD27() - 1;
        vm.expectRevert(NavAttestor.LiabilityOmitted.selector);
        _attest(a, p);

        uint256 spent = _next();
        pool.applyOp(pool.currentRoot(), _one(spent), new uint256[](0));
        a = _att(1);
        a.nullifiers[2] = spent;
        vm.expectRevert(abi.encodeWithSelector(NavAttestor.HoldingSpent.selector, spent));
        _attest(a, p);

        a = _att(1);
        (a.nullifiers[1], a.nullifiers[7]) = (99, 99);
        vm.expectRevert(NavAttestor.DuplicateHolding.selector);
        _attest(a, p);

        p[1] = NavAttestor.Price(address(stock), 1);
        p[5] = p[1];
        vm.expectRevert(abi.encodeWithSelector(NavAttestor.DuplicatePrice.selector, 5));
        _attest(_att(1), p);
        delete p[5];

        a = _att(1);
        a.root = 12345; // never a pool root
        vm.expectRevert(NavAttestor.InvalidProof.selector);
        _attest(a, p);

        v.set(false);
        vm.expectRevert(NavAttestor.InvalidProof.selector);
        _attest(_att(1), p);
        v.set(true);

        _attest(_att(1), p);
        vm.expectRevert(NavAttestor.TooEarly.selector);
        _attest(_att(2), p);
    }

    // =============================================================== PriceOracle

    function test_oracle_setFeed_bounds() public {
        vm.startPrank(gov);
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), AggregatorV3Interface(address(0)), 1 hours);
        uint32 minHb = oracle.MIN_HEARTBEAT();
        uint32 maxHb = oracle.MAX_HEARTBEAT();
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), feed, minHb - 1);
        vm.expectRevert(PriceOracle.BadFeed.selector);
        oracle.setFeed(address(stock), feed, maxHb + 1);
        vm.expectEmit(address(oracle));
        emit PriceOracle.FeedSet(address(stock), address(feed), minHb);
        oracle.setFeed(address(stock), feed, minHb);
        oracle.setFeed(address(stock), feed, maxHb);
        vm.stopPrank();
        (AggregatorV3Interface f, uint32 hb) = oracle.feeds(address(stock));
        assertEq(address(f), address(feed));
        assertEq(hb, maxHb);
    }

    function test_oracle_stockPriceAndMultiplier() public {
        // $100, 18 decimals, 1x: 100e27 per whole token / 1e18 raw units.
        assertEq(oracle.rawPrice(address(stock), 1), 100e27 / 1e18);
        assertTrue(oracle.ok(address(stock), 1));

        // A 2x multiplier announced for the future does not apply yet, and does not refuse the round.
        uint256 t = block.timestamp;
        vm.warp(t + 100);
        stock.setMultiplier(2e18); // effectiveAt = t + 100
        vm.warp(t + 50);
        assertEq(oracle.rawPrice(address(stock), 1), 2 * 100e27 / 1e18); // uiMultiplier already 2x in the mock

        // Once in force, a round published before the action is refused...
        vm.warp(t + 100);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, address(stock), uint80(1)));
        oracle.rawPrice(address(stock), 1);
        assertFalse(oracle.ok(address(stock), 1));
        // ...and a fresh round prices with the new multiplier.
        feed.set(100e8);
        assertEq(oracle.rawPrice(address(stock), 1), 2 * 100e27 / 1e18);
    }

    function test_oracle_treasury() public {
        MockUsd bill = new MockUsd();
        _list(address(bill), AssetGate.Class.TREASURY);
        MockFeed f = new MockFeed();
        f.set(1e8);
        _setFeed(address(bill), f, 1 days);
        assertEq(oracle.rawPrice(address(bill), 1), 1e27 / 1e6);
    }

    function test_oracle_vault4626() public {
        MockUsd usd = new MockUsd();
        MockVault vault = new MockVault(usd);
        usd.mint(address(this), 1000e6);
        usd.approve(address(vault), 1000e6);
        vault.deposit(1000e6, address(this));
        usd.mint(address(vault), 100e6); // yield: assets per share rises
        _list(address(vault), AssetGate.Class.VAULT4626);
        MockFeed f = new MockFeed();
        f.set(1e8);
        _setFeed(address(vault), f, 1 days);

        uint256 price = oracle.rawPrice(address(vault), 1);
        assertEq(price, 1e27 * vault.convertToAssets(1e6) / 1e6 / 1e6);
        assertGt(price, 1e21);
        assertEq(actions.multiplier(address(vault)), vault.convertToAssets(1e18));
    }

    function test_oracle_noFeed() public {
        address junk = makeAddr("junk");
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.NoFeed.selector, junk));
        oracle.rawPrice(junk, 1);
        assertFalse(oracle.ok(junk, 1));
    }

    function _roundAsset(RoundFeed f) internal returns (address a) {
        a = address(new MockStock());
        _setFeed(a, f, 1 hours);
    }

    function _expectStale(address a, uint80 id) internal {
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, a, id));
    }

    function test_oracle_staleRounds() public {
        uint256 t = block.timestamp;
        RoundFeed f = new RoundFeed();
        address a = _roundAsset(f);

        uint80 zero = f.push(0, t);
        _expectStale(a, zero);
        oracle.rawPrice(a, zero);

        uint80 negative = f.push(-1, t);
        _expectStale(a, negative);
        oracle.rawPrice(a, negative);

        uint80 neverUpdated = f.push(100e8, 0);
        _expectStale(a, neverUpdated);
        oracle.rawPrice(a, neverUpdated);

        uint80 good = f.push(100e8, t); // last round: no successor
        assertEq(oracle.rawPrice(a, good), 100e27 / 1e18);
        _expectStale(a, good);
        oracle.rawPriceAt(a, good, t - 1); // published after refTime

        vm.warp(t + 1 hours + 1); // beyond the heartbeat
        _expectStale(a, good);
        oracle.rawPrice(a, good);
        assertFalse(oracle.ok(a, good));
    }

    function test_oracle_replacedRound() public {
        uint256 t = block.timestamp;
        RoundFeed f = new RoundFeed();
        address a = _roundAsset(f);
        uint80 r1 = f.push(100e8, t - 100);
        uint80 r2 = f.push(101e8, t - 50);

        // r2 was already out at t, so r1 is not the round in force then.
        _expectStale(a, r1);
        oracle.rawPrice(a, r1);
        // At t - 60, r1 was still in force.
        assertEq(oracle.rawPriceAt(a, r1, t - 60), 100e27 / 1e18);
        assertEq(oracle.rawPrice(a, r2), 101e27 / 1e18);
        assertTrue(oracle.ok(a, r2));

        // A successor round with no timestamp does not replace it.
        uint80 r3 = f.push(102e8, 0);
        assertEq(oracle.rawPrice(a, r2), 101e27 / 1e18);
        _expectStale(a, r3);
        oracle.rawPrice(a, r3);
    }

    // =============================================================== DvPSettler

    function _price() internal view returns (DvPSettler.Price[16] memory p) {
        p[0] = DvPSettler.Price(address(stock), 0, 1, 0); // oracle-priced underlying
        p[1] = DvPSettler.Price(address(stock), 1, 0, 5e26); // PRINCIPAL claim at its quote
    }

    function _trade(uint256 hashA, uint256 hashB) internal returns (DvPSettler.Trade memory t) {
        t.root = pool.currentRoot();
        t.toleranceBps = 10;
        t.orders[0].orderHash = hashA;
        t.orders[0].nullifiers[0] = _next();
        t.orders[0].nullifiers[3] = _next();
        t.orders[1].orderHash = hashB;
        t.orders[1].nullifiers[0] = _next();
        t.commits[0] = _next();
        t.commits[1] = _next();
        t.commits[16] = _next();
        t.memos[0] = 5;
        t.memos[8] = 9;
    }

    function test_dvp_settlesBatch() public {
        DvPSettler.Price[16] memory p = _price();
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](2);
        trades[0] = _trade(11, 22);
        trades[1] = _trade(33, 44);
        uint256 leaves = pool.nextLeaf();

        vm.expectEmit(address(settler));
        emit DvPSettler.TradeSettled(0, 11, 22, trades[0].memos);
        vm.expectEmit(address(settler));
        emit DvPSettler.TradeSettled(0, 33, 44, trades[1].memos);
        vm.expectEmit(address(settler));
        emit DvPSettler.BatchSettled(0, 2, 6, keccak256(abi.encode(p)));
        vm.prank(sequencer);
        settler.submitBatch(block.timestamp, p, trades);

        for (uint256 i; i < 2; ++i) {
            assertTrue(pool.nullified(trades[i].orders[0].nullifiers[0]));
            assertTrue(pool.nullified(trades[i].orders[0].nullifiers[3]));
            assertTrue(pool.nullified(trades[i].orders[1].nullifiers[0]));
        }
        assertEq(pool.nextLeaf(), leaves + 6);
        assertEq(settler.batchSeq(), 1);
    }

    function test_dvp_exclusions() public {
        DvPSettler.Price[16] memory p = _price();
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](6);
        trades[0] = _trade(11, 22);
        trades[1] = _trade(orderV.BAD(), 22); // order proof rejected
        trades[2] = _trade(11, 22);
        trades[2].memos[0] = tradeV.BAD(); // trade proof rejected
        trades[3] = _trade(11, 22);
        trades[3].toleranceBps = settler.MAX_TOLERANCE_BPS() + 1;
        trades[4] = _trade(11, 22);
        trades[4].orders[1].nullifiers[5] = trades[0].orders[0].nullifiers[0]; // spent by trade 0
        trades[5] = _trade(11, orderV.BOOM()); // verifier reverts

        vm.expectEmit(address(settler));
        emit DvPSettler.TradeSettled(0, 11, 22, trades[0].memos);
        for (uint256 i = 1; i < 6; ++i) {
            vm.expectEmit(address(settler));
            emit DvPSettler.TradeExcluded(0, i);
        }
        vm.expectEmit(address(settler));
        emit DvPSettler.BatchSettled(0, 1, 3, keccak256(abi.encode(p)));
        vm.prank(sequencer);
        settler.submitBatch(block.timestamp, p, trades);

        for (uint256 i = 1; i < 6; ++i) {
            assertFalse(pool.nullified(trades[i].orders[0].nullifiers[3]), "excluded trade spent nothing");
        }
        assertEq(pool.nextLeaf(), 3);
    }

    function test_dvp_reverts() public {
        DvPSettler.Price[16] memory p = _price();
        DvPSettler.Trade[] memory none = new DvPSettler.Trade[](0);
        uint256 maxAge = settler.MAX_PROOF_AGE();

        vm.prank(stranger);
        vm.expectRevert(DvPSettler.NotSequencer.selector);
        settler.submitBatch(block.timestamp, p, none);

        vm.warp(block.timestamp + maxAge);
        vm.prank(sequencer);
        vm.expectRevert(DvPSettler.StaleProof.selector);
        settler.submitBatch(block.timestamp + 1, p, none);
        vm.prank(sequencer);
        vm.expectRevert(DvPSettler.StaleProof.selector);
        settler.submitBatch(block.timestamp - maxAge - 1, p, none);

        p[7] = p[1];
        vm.prank(sequencer);
        vm.expectRevert(abi.encodeWithSelector(DvPSettler.DuplicatePrice.selector, 7));
        settler.submitBatch(block.timestamp, p, none);

        uint8 dvp = control.DVP();
        vm.prank(guardian);
        control.pause(dvp);
        vm.prank(sequencer);
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, dvp));
        settler.submitBatch(block.timestamp, _price(), none);
    }

    // =============================================================== SolvencyVerifier

    function test_solvency_attest() public {
        _deposit(1000);
        vm.expectEmit(address(solvency));
        emit SolvencyVerifier.Solvent(address(stock), 1, 1000, 1000);
        SolvencyVerifier.Record memory r = solvency.attest(address(stock));
        assertEq(r.epoch, 1);
        assertEq(r.ts, block.timestamp);
        (uint64 epoch, uint64 ts, uint256 bal, uint256 claims) = solvency.latest(address(stock));
        assertEq(epoch, 1);
        assertEq(ts, block.timestamp);
        assertEq(bal, 1000);
        assertEq(claims, 1000);

        vm.expectRevert(SolvencyVerifier.TooEarly.selector);
        solvency.attest(address(stock));

        vm.warp(block.timestamp + solvency.EPOCH());
        pool.creditFee(address(stock), 100); // fees still count as claims
        assertEq(solvency.attest(address(stock)).epoch, 2);

        vm.warp(block.timestamp + solvency.EPOCH());
        vm.prank(address(pool));
        stock.transfer(stranger, 1);
        vm.expectRevert(abi.encodeWithSelector(SolvencyVerifier.Deficit.selector, address(stock), 999, 1000));
        solvency.attest(address(stock));
        (epoch,,,) = solvency.latest(address(stock));
        assertEq(epoch, 2);
    }

    // =============================================================== BundleVerifier

    function test_bundle_happyPaths() public {
        _depositAndClear(1000);
        uint256 now_ = block.timestamp;

        BundleVerifier.Bundle memory b;
        b.root = pool.currentRoot();
        b.now_ = now_;
        b.asset = address(stock);
        b.feeRaw = 10;
        b.nullifier = _next();
        for (uint256 i; i < 5; ++i) {
            b.commits[i] = _next();
        }
        vm.expectEmit(address(bundler));
        emit BundleVerifier.Bundled(address(stock), 10);
        bundler.bundle("", b);
        assertEq(pool.fees(address(stock)), 10);
        assertEq(pool.owed(address(stock)), 990);

        b.root = pool.currentRoot();
        b.feeRaw = 0;
        b.nullifier = _next();
        b.commits[0] = _next();
        bundler.bundle("", b);
        assertEq(pool.fees(address(stock)), 10);

        BundleVerifier.Unbundle memory u;
        u.root = pool.currentRoot();
        u.now_ = now_;
        u.asset = address(stock);
        for (uint256 i; i < 5; ++i) {
            u.nullifiers[i] = _next();
        }
        u.commit = _next();
        vm.expectEmit(address(bundler));
        emit BundleVerifier.Unbundled(address(stock));
        bundler.unbundle("", u);
        assertTrue(pool.nullified(u.nullifiers[4]));

        BundleVerifier.Term memory t;
        t.root = pool.currentRoot();
        t.now_ = now_;
        t.nullifier = _next();
        t.commits = [_next(), _next()];
        vm.expectEmit(address(bundler));
        emit BundleVerifier.Termed();
        bundler.term("", t);
        assertTrue(pool.nullified(t.nullifier));

        BundleVerifier.Claim memory c;
        c.root = pool.currentRoot();
        c.asset = address(stock);
        c.tStart = t0;
        c.tEnd = now_;
        c.nullifier = _next();
        c.next = _next();
        c.payout = _next();
        vm.expectEmit(address(bundler));
        emit BundleVerifier.IncomeClaimed(address(stock), now_);
        bundler.claimIncome("", c);
        assertTrue(pool.nullified(c.nullifier));
    }

    // =============================================================== ActionEngine

    function test_actions_checkpointsAndViews() public {
        MockStock s = new MockStock();
        _list(address(s), AssetGate.Class.STOCK8056);
        vm.expectRevert(abi.encodeWithSelector(ActionEngine.NoIndex.selector, address(s), block.timestamp));
        actions.latest(address(s));

        uint256 t = block.timestamp;
        actions.sync(address(s));
        // Income in the same second rewrites that second's checkpoint.
        s.setMultiplier(1.01e18);
        (, uint256 j) = actions.sync(address(s));
        assertEq(actions.checkpointCount(address(s)), 1);
        assertEq(j, J1);

        vm.warp(t + 10);
        s.setMultiplier(1.02e18);
        actions.sync(address(s));
        assertEq(actions.checkpointCount(address(s)), 2);
        assertEq(actions.indexAt(address(s), t + 5), j);
        (uint256 ts2,) = actions.checkpointAt(address(s), t + 10);
        assertEq(ts2, t + 10);
        vm.expectRevert(abi.encodeWithSelector(ActionEngine.NoIndex.selector, address(s), t - 1));
        actions.checkpointAt(address(s), t - 1);

        // A zero multiplier (broken token) keeps the last index rather than reverting.
        vm.warp(t + 20);
        s.setMultiplier(0);
        (uint256 tsz, uint256 jz) = actions.sync(address(s));
        assertEq(tsz, t + 10);
        assertEq(jz, J2);

        MockUsd bill = new MockUsd();
        _list(address(bill), AssetGate.Class.TREASURY);
        assertEq(actions.multiplier(address(bill)), 1e18);
        assertEq(actions.multiplier(address(stock)), 1e18);
    }

    function test_actions_onlyKeeper() public {
        vm.startPrank(stranger);
        vm.expectRevert(ActionEngine.NotKeeper.selector);
        actions.confirmStep(address(stock));
        vm.expectRevert(ActionEngine.NotKeeper.selector);
        actions.setIncomePaused(address(stock), true);
        vm.expectRevert(ActionEngine.NotKeeper.selector);
        actions.scheduleSplit(address(stock), 2, 1, uint64(block.timestamp));
        vm.stopPrank();
    }

    // =============================================================== AssetGate / CordonControl

    function test_gate_setTemplatesAndCount() public {
        assertEq(gate.assetCount(), 1);
        assertEq(gate.assetList(0), address(stock));
        vm.expectEmit(address(gate));
        emit AssetGate.TemplatesSet(address(stock), 1);
        vm.prank(gov);
        gate.setTemplates(address(stock), 1);
        (,,, uint8 templates) = gate.assets(address(stock));
        assertEq(templates, 1);
    }

    function test_control_unpauseAndGuardian() public {
        uint8 deposits = control.DEPOSITS();
        uint8 bundle = control.BUNDLE();
        vm.prank(gov);
        control.pause(deposits | bundle);
        assertEq(control.paused(), deposits | bundle);
        vm.expectEmit(address(control));
        emit CordonControl.Unpaused(deposits);
        vm.prank(gov);
        control.unpause(deposits);
        assertEq(control.paused(), bundle);
        control.requireActive(deposits);

        address g2 = makeAddr("guardian2");
        vm.expectEmit(address(control));
        emit CordonControl.GuardianSet(g2);
        vm.prank(gov);
        control.setGuardian(g2);
        assertEq(control.guardian(), g2);
        vm.prank(guardian);
        vm.expectRevert(CordonControl.NotGuardian.selector);
        control.pause(1);
    }

    // =============================================================== CordonPool

    function test_pool_clearAndUnshieldBranches() public {
        uint256 a = _deposit(100);
        uint256 b = _deposit(200);
        assertEq(pool.depositCount(), 2);
        uint256[] memory ids = new uint256[](2);
        (ids[0], ids[1]) = (a, b);

        vm.expectRevert(abi.encodeWithSelector(CordonPool.InStandby.selector, a));
        pool.clear(ids);

        vm.prank(keeper);
        screening.flag(b);
        vm.warp(block.timestamp + pool.STANDBY());
        vm.expectRevert(abi.encodeWithSelector(CordonPool.DepositFlagged.selector, b));
        pool.clear(ids);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.NotOrigin.selector, b));
        pool.unshieldToOrigin(b);
        vm.prank(alice);
        pool.unshieldToOrigin(b);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CordonPool.DepositSettled.selector, b));
        pool.unshieldToOrigin(b);

        // b is settled (returned) and skipped; a enters the tree; a second clear is a no-op.
        pool.clear(ids);
        assertEq(pool.nextLeaf(), 1);
        uint256 root = pool.currentRoot();
        pool.clear(ids);
        assertEq(pool.currentRoot(), root);
    }

    function test_pool_treeFull() public {
        stdstore.target(address(pool)).sig("nextLeaf()").checked_write(uint256(2 ** 32));
        uint256 root = pool.currentRoot();
        uint256 c = _next();
        vm.expectRevert(CordonPool.TreeFull.selector);
        pool.applyOp(root, new uint256[](0), _one(c));
    }

    // =============================================================== CrdnStaking / EncumbranceRegistry

    function test_staking_viewsAndLocks() public {
        crdn.mint(alice, 1000);
        vm.startPrank(alice);
        crdn.approve(address(staking), 1000);
        staking.stake(1000);
        vm.expectRevert(CrdnStaking.Locked.selector);
        staking.unstake(1);
        uint256 id = staking.propose(CrdnStaking.Subject.ASSET_CLASS, keccak256("x"));
        vm.stopPrank();
        assertEq(staking.proposalCount(), 1);
        assertEq(id, 0);

        vm.expectRevert(abi.encodeWithSelector(CrdnStaking.NotFeeToken.selector, address(crdn)));
        staking.distribute(address(crdn));
        address junk = makeAddr("junk");
        vm.expectRevert(abi.encodeWithSelector(CrdnStaking.NotFeeToken.selector, junk));
        staking.distribute(junk);

        stock.mint(address(staking), 1000);
        staking.distribute(address(stock));
        assertEq(staking.claimable(alice, address(stock)), 50);
    }

    function test_enc_declareDefault_notKeeper() public {
        vm.prank(stranger);
        vm.expectRevert(EncumbranceRegistry.NotKeeper.selector);
        registry.declareDefault(1);
    }

    function test_ownable_notOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        oracle.setFeed(address(stock), feed, 1 hours);
    }
}
