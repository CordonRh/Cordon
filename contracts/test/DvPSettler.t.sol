// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetGate} from "../src/AssetGate.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {DvPSettler} from "../src/DvPSettler.sol";
import {PriceOracle} from "../src/PriceOracle.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {CordonTest, MockStock} from "./Base.t.sol";

contract MockFeed is AggregatorV3Interface {
    int256 public answer;
    uint256 public updatedAt;

    function set(int256 a) external {
        answer = a;
        updatedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }

    /// One round (id 1): a later round does not exist yet.
    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(id == 1, "No data present");
        return (id, answer, updatedAt, updatedAt, id);
    }
}

contract MockUsd is MockStock {
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract DvPSettlerTest is CordonTest {
    uint256 internal constant LEGS = 16;
    uint256 internal constant GIVES = 8;
    uint256 internal constant P = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    address internal sequencer = makeAddr("tee");
    uint256 internal skB = 0xB0B;
    uint256 internal pkB;

    PriceOracle internal oracle;
    DvPSettler internal settler;
    MockStock[8] internal stocks;
    MockFeed[8] internal stockFeeds;
    MockUsd internal usdg;
    MockFeed internal usdFeed;

    struct Give {
        bool active;
        uint8 priceIdx;
        Note note;
        uint256 amount;
    }

    struct Order {
        Give[GIVES] gives;
        uint256 wantAsset;
        uint256 wantMin;
        uint256 receivePk;
        uint256 expiry;
        uint256 salt;
    }

    function setUp() public override {
        super.setUp();
        pkB = hasher.hash_1(skB);
        oracle = new PriceOracle(gov, gate);
        settler = new DvPSettler(pool, oracle, _verifier("Dvp"), _verifier("Order"));
        (uint8 all, uint8 templates) = (gate.ALL_CLAIMS(), gate.ALL_TEMPLATES());
        vm.startPrank(gov);
        control.setEngine(address(settler), true);
        control.setSequencer(sequencer);
        for (uint256 i; i < 8; ++i) {
            stocks[i] = new MockStock();
            stocks[i].mint(alice, 1e24);
            stockFeeds[i] = new MockFeed();
            gate.register(address(stocks[i]), AssetGate.Class.STOCK8056, all, templates);
            oracle.setFeed(address(stocks[i]), stockFeeds[i], 1 days);
        }
        usdg = new MockUsd();
        usdg.mint(alice, 1e24);
        usdFeed = new MockFeed();
        gate.register(address(usdg), AssetGate.Class.TREASURY, all, templates);
        oracle.setFeed(address(usdg), usdFeed, 1 days);
        vm.stopPrank();
    }

    function _markPrices() internal {
        for (uint256 i; i < 8; ++i) {
            stockFeeds[i].set(100e8); // $100 per share
        }
        usdFeed.set(1e8);
    }

    function _prices() internal view returns (DvPSettler.Price[16] memory p) {
        for (uint256 i; i < 8; ++i) {
            p[i] = DvPSettler.Price(address(stocks[i]), 0, 1, 0);
        }
        p[8] = DvPSettler.Price(address(usdg), 0, 1, 0);
    }

    // ------------------------------------------------------------ TOML

    function _orderToml(Order memory o) internal pure returns (string memory t) {
        t = "{ gives = [";
        for (uint256 i; i < GIVES; ++i) {
            Give memory g = o.gives[i];
            t = string.concat(t, i == 0 ? "" : ", ", "{ active = ", g.active ? "true" : "false");
            t = string.concat(t, ", note = ", _noteToml(g.note), ", amount = ", _s(g.amount), ", price_quote = \"0\" }");
        }
        t = string.concat(t, "], want_asset = ", _s(o.wantAsset), ", want_kind = \"0\", want_quote = \"0\"");
        t = string.concat(t, ", want_class = \"0\", want_min = ", _s(o.wantMin));
        t = string.concat(t, ", receive_pk = ", _s(o.receivePk), ", expiry = ", _s(o.expiry));
        t = string.concat(t, ", salt = ", _s(o.salt), " }");
    }

    function _legsToml(Order memory o) internal view returns (string memory t) {
        uint256[DEPTH] memory empty;
        t = "[";
        for (uint256 i; i < GIVES; ++i) {
            Give memory g = o.gives[i];
            uint256 idx = g.active ? _indexOf(g.note) : 0;
            t = string.concat(t, i == 0 ? "" : ", ", "{ price_idx = ", _s(g.priceIdx), ", index = ", _s(idx));
            t = string.concat(t, ", path = ", _pathToml(g.active ? _path(idx) : empty), " }");
        }
        t = string.concat(t, "]");
    }

    function _tradeToml(Order[2] memory os, uint256 tol) internal view returns (string memory t) {
        DvPSettler.Price[16] memory p = _prices();
        string memory pa = "price_asset = [";
        string memory pk = "price_kind = [";
        string memory pr = "price = [";
        for (uint256 i; i < 16; ++i) {
            string memory sep = i == 0 ? "" : ", ";
            uint256 v = p[i].asset == address(0) ? 0 : oracle.rawPrice(p[i].asset, 1);
            pa = string.concat(pa, sep, _s(uint160(p[i].asset)));
            pk = string.concat(pk, sep, _s(p[i].kind));
            pr = string.concat(pr, sep, _s(v));
        }
        t = string.concat(_kv("root", pool.currentRoot()), _kv("now", block.timestamp), _kv("tolerance_bps", tol));
        t = string.concat(t, pa, "]\n", pk, "]\n", pr, "]\n");
        t = string.concat(t, "orders = [", _orderToml(os[0]), ", ", _orderToml(os[1]), "]\n");
        t = string.concat(t, "legs = [", _legsToml(os[0]), ", ", _legsToml(os[1]), "]\n");
    }

    /// What each trader proves in its browser: the order's terms and its notes' nullifiers.
    function _auth(Order memory o, uint256 key) internal returns (DvPSettler.OrderAuth memory a) {
        (bytes memory proof, bytes32[] memory pub) =
            _prove("order", string.concat(_kv("sk", key), "order = ", _orderToml(o), "\n"));
        a.proof = proof;
        a.orderHash = _u(pub[0]);
        for (uint256 i; i < GIVES; ++i) {
            a.nullifiers[i] = _u(pub[1 + i]);
        }
    }

    /// The sequencer's trade proof over `os`, settled with the traders' own order proofs.
    function _trade(Order[2] memory os, DvPSettler.OrderAuth[2] memory auths, uint256 tol)
        internal
        returns (DvPSettler.Trade memory tr)
    {
        (bytes memory proof, bytes32[] memory pub) = _prove("dvp", _tradeToml(os, tol));
        tr.proof = proof;
        tr.root = _u(pub[0]);
        tr.toleranceBps = tol;
        tr.orders = auths;
        uint256 o = 3 + 48 + 2;
        for (uint256 i; i < 2 * LEGS; ++i) {
            tr.commits[i] = _u(pub[o + i]);
        }
        for (uint256 i; i < LEGS; ++i) {
            tr.memos[i] = _u(pub[o + 2 * LEGS + i]);
        }
    }

    /// Alice sells 8 notes of one share of a Stock Token to Bob for 8 notes of 100 USDG:
    /// $800 each way, 16 legs.
    function _basket() internal returns (Order[2] memory os) {
        for (uint256 i; i < 8; ++i) {
            Note memory s = _depositFor(address(stocks[0]), 1e18, 300 + i, ownerPk);
            os[0].gives[i] = Give(true, 0, s, 1e18);
            Note memory u = _depositFor(address(usdg), 100e6, 400 + i, pkB);
            os[1].gives[i] = Give(true, 8, u, 100e6);
        }
        os[0].wantAsset = uint160(address(usdg));
        os[1].wantAsset = uint160(address(stocks[0]));
        os[0].receivePk = ownerPk;
        os[1].receivePk = pkB;
        for (uint256 p; p < 2; ++p) {
            os[p].expiry = block.timestamp + 1 hours;
            os[p].salt = 77 + p;
        }
        _markPrices();
    }

    function _auths(Order[2] memory os) internal returns (DvPSettler.OrderAuth[2] memory a) {
        a[0] = _auth(os[0], sk);
        a[1] = _auth(os[1], skB);
    }

    function _submit(DvPSettler.Trade memory t) internal {
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](1);
        trades[0] = t;
        vm.prank(sequencer);
        settler.submitBatch(block.timestamp, _prices(), trades);
    }

    // ------------------------------------------------------------ tests

    function test_sixteenLegTradeSettles() public {
        Order[2] memory os = _basket();
        DvPSettler.Trade memory t = _trade(os, _auths(os), 10);

        // Bob's first new note: Alice's first share, now keyed to Bob, blinded from Bob's
        // own order salt, and its amount readable by Bob alone from the published memo.
        Note memory got = _copy(os[0].gives[0].note);
        got.ownerPk = pkB;
        got.blinding = hasher.hash_3(os[1].salt, 0, 1);
        assertEq(t.commits[0], commitOf(got));
        assertEq(addmod(t.memos[0], P - hasher.hash_3(os[1].salt, 0, 3), P), 1e18, "Bob recovers the amount");

        uint256 before = pool.nextLeaf();
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](1);
        trades[0] = t;
        vm.prank(sequencer);
        vm.expectEmit(true, false, false, true, address(settler));
        emit DvPSettler.BatchSettled(0, 1, 16, keccak256(abi.encode(_prices())));
        settler.submitBatch(block.timestamp, _prices(), trades);
        assertEq(pool.nextLeaf(), before + 16, "one note per leg, no change notes");
        assertTrue(pool.nullified(t.orders[1].nullifiers[7]));
    }

    function test_partialGiveReturnsChange() public {
        Order[2] memory os = _basket();
        // Alice gives 1 share from a 2-share note; the other share comes back as change.
        Note memory two = _depositFor(address(stocks[0]), 2e18, 500, ownerPk);
        os[0].gives[0] = Give(true, 0, two, 1e18);
        DvPSettler.Trade memory t = _trade(os, _auths(os), 10);
        Note memory change = _copy(two);
        change.raw = 1e18;
        change.blinding = hasher.hash_3(os[0].salt, 0, 2);
        assertEq(t.commits[1], commitOf(change));
        _submit(t);
        assertTrue(pool.nullified(t.orders[0].nullifiers[0]));
    }

    /// The sequencer proves a trade that pays Alice's side to itself: the trade proof is
    /// valid, but its order hash is not the one Alice proved, so the trade is left out.
    function test_sequencerCannotRedirectAnOrder() public {
        Order[2] memory os = _basket();
        DvPSettler.OrderAuth[2] memory auths = _auths(os);
        os[0].receivePk = hasher.hash_1(0x5EC);
        DvPSettler.Trade memory t = _trade(os, auths, 10);
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](1);
        trades[0] = t;
        vm.prank(sequencer);
        vm.expectEmit(true, false, false, true, address(settler));
        emit DvPSettler.TradeExcluded(0, 0);
        settler.submitBatch(block.timestamp, _prices(), trades);
        assertFalse(pool.nullified(auths[0].nullifiers[0]));
    }

    /// Without the owner's key there is no order proof for its notes.
    function test_orderNeedsTheOwnersKey() public {
        Order[2] memory os = _basket();
        (int256 code,) = _tryProve("order", string.concat(_kv("sk", skB), "order = ", _orderToml(os[0]), "\n"));
        assertTrue(code != 0);
    }

    function test_expiredOrderCannotProve() public {
        Order[2] memory os = _basket();
        os[1].expiry = block.timestamp - 1;
        (int256 code,) = _tryProve("dvp", _tradeToml(os, 10));
        assertTrue(code != 0);
    }

    function test_badTradeExcludedBatchStillSettles() public {
        Order[2] memory os = _basket();
        DvPSettler.Trade memory good = _trade(os, _auths(os), 10);
        // Same proof, but claims a wider tolerance than it was proven with.
        DvPSettler.Trade memory bad;
        bad.proof = good.proof;
        bad.root = good.root;
        bad.toleranceBps = 11;
        bad.orders = good.orders;
        bad.commits = good.commits;

        DvPSettler.Trade[] memory order = new DvPSettler.Trade[](2);
        order[0] = bad;
        order[1] = good;
        vm.prank(sequencer);
        vm.expectEmit(true, false, false, true, address(settler));
        emit DvPSettler.TradeExcluded(0, 0);
        settler.submitBatch(block.timestamp, _prices(), order);
        assertTrue(pool.nullified(good.orders[0].nullifiers[0]), "valid trade settled");
    }

    function test_staleOracleDefersBatch() public {
        Order[2] memory os = _basket();
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](1);
        trades[0] = _trade(os, _auths(os), 10);
        vm.warp(block.timestamp + 2 days);
        DvPSettler.Price[16] memory p = _prices();
        vm.prank(sequencer);
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.StaleOracle.selector, address(stocks[0]), 1));
        settler.submitBatch(block.timestamp, p, trades);
    }

    function test_tradeThatDoesNotNetCannotProve() public {
        Order[2] memory os = _basket();
        os[1].gives[7].active = false; // Bob pays $700 for $800 of stock
        (int256 code,) = _tryProve("dvp", _tradeToml(os, 10));
        assertTrue(code != 0);
    }

    function test_onlySequencerAndPause() public {
        DvPSettler.Trade[] memory none = new DvPSettler.Trade[](0);
        DvPSettler.Price[16] memory p;
        vm.expectRevert(DvPSettler.NotSequencer.selector);
        settler.submitBatch(block.timestamp, p, none);

        uint8 dvp = control.DVP();
        vm.prank(guardian);
        control.pause(dvp);
        vm.prank(sequencer);
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, dvp));
        settler.submitBatch(block.timestamp, p, none);
    }

    /// An order states the fewest units it accepts; a sequencer that settles it for less
    /// cannot prove the trade.
    function test_wantMinBindsTheFill() public {
        Order[2] memory os = _basket();
        os[1].wantMin = 8e18 + 1; // Bob wants more TSLA than Alice gives
        (int256 code,) = _tryProve("dvp", _tradeToml(os, 10));
        assertTrue(code != 0);
    }

    /// Two entries for one (asset, kind) would let the sequencer price legs at different marks.
    function test_duplicatePriceRejected() public {
        Order[2] memory os = _basket();
        DvPSettler.Trade[] memory trades = new DvPSettler.Trade[](1);
        trades[0] = _trade(os, _auths(os), 10);
        DvPSettler.Price[16] memory p = _prices();
        p[9] = p[0];
        vm.prank(sequencer);
        vm.expectRevert(abi.encodeWithSelector(DvPSettler.DuplicatePrice.selector, 9));
        settler.submitBatch(block.timestamp, p, trades);
    }
}
