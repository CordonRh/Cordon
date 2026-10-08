// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ActionEngine} from "../src/ActionEngine.sol";
import {AssetGate} from "../src/AssetGate.sol";
import {BundleVerifier} from "../src/BundleVerifier.sol";
import {CordonControl} from "../src/CordonControl.sol";
import {CordonPool} from "../src/CordonPool.sol";
import {CordonTest, MockStock} from "./Base.t.sol";

contract MockVault is ERC4626 {
    constructor(IERC20 usdg) ERC20("Mock USDG vault", "mvUSDG") ERC4626(usdg) {}
}

abstract contract BundleHelpers is CordonTest {
    uint256 internal constant R = 1_000_000;
    address internal bob = makeAddr("bob");

    struct Bundled {
        Note[5] claims;
        uint256 raw;
        uint256 j;
        uint256 at;
    }

    // ------------------------------------------------------------ helpers

    function _bundle(Note memory u, uint8 mask) internal returns (Bundled memory b) {
        (, uint256 j) = actions.latest(address(stock));
        uint256 fee = u.raw / 1000;
        b.raw = u.raw - fee;
        b.j = j;
        b.at = block.timestamp;
        uint256 bundleId = hasher.hash_1(commitOf(u));
        for (uint256 k; k < 5; ++k) {
            Note memory c = _note(b.raw, 100 + k + u.blinding * 10);
            c.kind = k + 1;
            c.bundleId = bundleId;
            c.jBundle = j;
            if (c.kind == INCOME) c.accruedTo = block.timestamp;
            b.claims[k] = c;
        }

        string memory toml = string.concat(
            _kv("root", pool.currentRoot()),
            _kv("now", block.timestamp),
            _kv("asset", uint160(address(stock))),
            _kv("j_now", j)
        );

        toml = string.concat(toml, _kv("claim_mask", mask), _kv("fee_raw", fee), _kv("sk", sk));

        toml = string.concat(toml, string.concat("underlying = ", _noteToml(u), "\n"), _witness(u, "index", "path"));
        toml = string.concat(toml, "blindings = [");
        for (uint256 k; k < 5; ++k) {
            toml = string.concat(toml, k == 0 ? "" : ", ", _s(b.claims[k].blinding));
        }
        toml = string.concat(toml, "]\n");

        (bytes memory proof, bytes32[] memory pub) = _prove("bundle", toml);
        uint256[5] memory commits;
        for (uint256 k; k < 5; ++k) {
            commits[k] = _u(pub[7 + k]);
            bool on = (mask >> k) & 1 == 1;
            assertEq(commits[k], on ? commitOf(b.claims[k]) : 0, "claim commit");
        }
        bundler.bundle(proof, BundleVerifier.Bundle(_u(pub[0]), _u(pub[1]), address(stock), fee, _u(pub[6]), commits));
        for (uint256 k; k < 5; ++k) {
            _track(commits[k]);
        }
    }

    function _unbundleToml(Note[5] memory claims, uint8 mask, uint256 outRaw)
        internal
        view
        returns (string memory toml)
    {
        (uint256 ts, uint256 j) = actions.latest(address(stock));
        toml = string.concat(
            _kv("root", pool.currentRoot()),
            _kv("now", block.timestamp),
            _kv("asset", uint160(address(stock))),
            _kv("j_now", j)
        );
        toml = string.concat(toml, _kv("t_last", ts), _kv("claim_mask", mask), _kv("sk", sk));
        toml = string.concat(toml, _kv("out_blinding", 777), _kv("out_raw", outRaw));
        toml = string.concat(toml, _claimsToml(claims, mask));
    }

    function _claimsToml(Note[5] memory claims, uint8 mask) internal view returns (string memory) {
        string memory notes = "claims = [";
        string memory idx = "index = [";
        string memory paths = "path = [";
        uint256[DEPTH] memory empty;
        for (uint256 k; k < 5; ++k) {
            bool on = (mask >> k) & 1 == 1;
            uint256 i = on ? _indexOf(claims[k]) : 0;
            string memory sep = k == 0 ? "" : ", ";
            notes = string.concat(notes, sep, _noteToml(claims[k]));
            idx = string.concat(idx, sep, _s(i));
            paths = string.concat(paths, sep, _pathToml(on ? _path(i) : empty));
        }
        return string.concat(notes, "]\n", idx, "]\n", paths, "]\n");
    }

    /// Unbundles and returns the underlying note it created.
    function _unbundle(Note[5] memory claims, uint8 mask) internal returns (Note memory out) {
        (, uint256 j) = actions.latest(address(stock));
        out = _note(claims[0].raw * j / claims[0].jBundle, 777);
        (bytes memory proof, bytes32[] memory pub) = _prove("unbundle", _unbundleToml(claims, mask, out.raw));
        uint256[5] memory nullifiers;
        for (uint256 k; k < 5; ++k) {
            nullifiers[k] = _u(pub[6 + k]);
        }
        assertEq(_u(pub[11]), commitOf(out), "underlying commit");
        bundler.unbundle(
            proof, BundleVerifier.Unbundle(_u(pub[0]), _u(pub[1]), address(stock), nullifiers, _u(pub[11]))
        );
        _track(_u(pub[11]));
    }

    struct ClaimCase {
        uint256 tStart;
        uint256 tEnd;
        uint256 jStart;
        uint256 jEnd;
    }

    function _claimToml(Note memory n, ClaimCase memory c, Note memory payout, Note memory next)
        internal
        view
        returns (string memory)
    {
        string memory head = string.concat(
            _kv("root", pool.currentRoot()),
            _kv("asset", uint160(address(stock))),
            _kv("t_start", c.tStart),
            _kv("t_end", c.tEnd)
        );
        head = string.concat(head, _kv("j_start", c.jStart), _kv("j_end", c.jEnd), _kv("sk", sk));
        string memory _t = string.concat(
            head,
            string.concat("note = ", _noteToml(n), "\n"),
            _witness(n, "index", "path"),
            _kv("payout_raw", payout.raw)
        );
        _t = string.concat(_t, string.concat("blindings = [", _s(next.blinding), ", ", _s(payout.blinding), "]\n"));
        return _t;
    }

    /// Claims income on `n` up to now (or its term end); returns the payout and the advanced note.
    function _claim(Note memory n) internal returns (Note memory payout, Note memory next) {
        ClaimCase memory c;
        c.tStart = n.accruedTo > n.termFrom ? n.accruedTo : n.termFrom;
        c.tEnd = n.termUntil != 0 && n.termUntil < block.timestamp ? n.termUntil : block.timestamp;
        c.jStart = actions.indexAt(address(stock), c.tStart);
        c.jEnd = actions.indexAt(address(stock), c.tEnd);
        payout = _note(n.raw * (c.jStart - c.jEnd) / n.jBundle, n.blinding + 5000);
        next = _copy(n);
        next.accruedTo = c.tEnd;
        next.blinding = n.blinding + 6000;

        (bytes memory proof, bytes32[] memory pub) = _prove("income", _claimToml(n, c, payout, next));
        assertEq(_u(pub[7]), commitOf(next), "next income commit");
        assertEq(_u(pub[8]), commitOf(payout), "payout commit");
        bundler.claimIncome(
            proof,
            BundleVerifier.Claim(_u(pub[0]), address(stock), c.tStart, c.tEnd, _u(pub[6]), _u(pub[7]), _u(pub[8]))
        );
        _track(_u(pub[7]));
        _track(_u(pub[8]));
    }

    function _termToml(Note memory income, uint256 until) internal view returns (string memory) {
        string memory _t = string.concat(
            _kv("root", pool.currentRoot()),
            _kv("now", block.timestamp),
            _kv("sk", sk),
            string.concat("income = ", _noteToml(income), "\n")
        );
        _t = string.concat(
            _t,
            _witness(income, "index", "path"),
            _kv("until", until),
            string.concat("blindings = [", _s(income.blinding + 1), ", ", _s(income.blinding + 2), "]\n")
        );
        return _t;
    }

    function _term(Note memory income, uint256 until) internal returns (Note memory termed, Note memory rest) {
        termed = _copy(income);
        termed.termUntil = until;
        termed.blinding = income.blinding + 1;
        rest = _copy(income);
        rest.termFrom = until;
        rest.blinding = income.blinding + 2;
        (bytes memory proof, bytes32[] memory pub) = _prove("term", _termToml(income, until));
        assertEq(_u(pub[3]), commitOf(termed));
        assertEq(_u(pub[4]), commitOf(rest));
        bundler.term(proof, BundleVerifier.Term(_u(pub[0]), _u(pub[1]), _u(pub[2]), [_u(pub[3]), _u(pub[4])]));
        _track(_u(pub[3]));
        _track(_u(pub[4]));
    }

    function _dividend(uint256 m) internal {
        vm.warp(block.timestamp + 1 days);
        stock.setMultiplier(m);
        actions.sync(address(stock));
        vm.warp(block.timestamp + 1);
    }
}

contract BundleVerifierTest is BundleHelpers {
    // ------------------------------------------------------------ tests

    function test_bundleUnbundleConservesRaw() public {
        Note memory u = _depositNote(R, 1);
        Bundled memory b = _bundle(u, 31);
        assertEq(b.raw, R - R / 1000);
        assertEq(pool.fees(address(stock)), R / 1000, "10 bps fee in raw units");

        Note memory out = _unbundle(b.claims, 31);
        assertEq(out.raw, b.raw, "5 claims re-form the underlying");

        pool.collectFees(address(stock));
        assertEq(stock.balanceOf(feeSink), R / 1000);
        assertEq(stock.balanceOf(address(pool)), b.raw);
    }

    function test_incomeClaimAndPrincipalSumToBundle() public {
        Note memory u = _depositNote(R, 2);
        Bundled memory b = _bundle(u, 31);
        _dividend(1.02e18); // 2% reinvested dividend

        (Note memory payout, Note memory next) = _claim(b.claims[1]);
        (, uint256 j1) = actions.latest(address(stock));
        b.claims[1] = next;
        Note memory principal = _unbundle(b.claims, 31);

        assertEq(payout.raw, b.raw * (b.j - j1) / b.j);
        assertApproxEqAbs(payout.raw + principal.raw, b.raw, 1, "raw conserved within 1 unit");
        // PRINCIPAL keeps its value at bundling: raw_left * m_now == raw * m_then.
        assertApproxEqAbs(principal.raw * 1.02e18 / 1e18, b.raw, 1, "principal value unchanged");
    }

    function test_splitIsNotIncome() public {
        Note memory u = _depositNote(R, 3);
        Bundled memory b = _bundle(u, 31);
        uint256 before = actions.checkpointCount(address(stock));

        vm.prank(keeper);
        actions.scheduleSplit(address(stock), 2, 1, uint64(block.timestamp + 1 days));
        _dividend(2e18); // the 2:1 split lands at effectiveAt

        assertEq(actions.checkpointCount(address(stock)), before, "income index unchanged");
        assertEq(_unbundle(b.claims, 31).raw, b.raw, "raw invariant across the split");
    }

    function test_termSellsIncomeUntilExpiry() public {
        Note memory u = _depositNote(R, 4);
        Bundled memory b = _bundle(u, 31);
        uint256 T = block.timestamp + 365 days;
        (Note memory termed, Note memory rest) = _term(b.claims[1], T);

        // While the 12-month income is out, the bundle cannot re-form.
        Note[5] memory claims = b.claims;
        claims[1] = rest;
        (int256 code,) = _tryProve("unbundle", _unbundleToml(claims, 31, b.raw));
        assertTrue(code != 0, "remainder before T");

        _dividend(1.05e18);
        vm.warp(T + 1);
        // The termed note still collects what accrued up to T...
        (Note memory payout,) = _claim(termed);
        assertGt(payout.raw, 0);
        // ...but can no longer move.
        Note memory dummy = _note(0, 9);
        string memory toml = string.concat(
            _kv("root", pool.currentRoot()), _kv("now", block.timestamp), _kv("asset", 0), _kv("withdraw_raw", 0)
        );
        toml = string.concat(
            toml,
            _kv("recipient", 0),
            _kv("sk", sk),
            string.concat("ins = [", _noteToml(termed), ", ", _noteToml(dummy), "]\n")
        );
        toml = string.concat(toml, string.concat("in_index = [", _s(_indexOf(termed)), ", \"0\"]\n"));
        uint256[DEPTH] memory empty;
        toml = string.concat(
            toml,
            string.concat("in_path = [", _pathToml(_path(_indexOf(termed))), ", ", _pathToml(empty), "]\n"),
            string.concat("outs = [", _noteToml(termed), ", ", _noteToml(dummy), "]\n")
        );
        (code,) = _tryProve("transfer", toml);
        assertTrue(code != 0, "expired income term cannot transfer");

        // After T the remainder is a full INCOME right again and the bundle re-forms.
        (, uint256 j) = actions.latest(address(stock));
        assertEq(_unbundle(claims, 31).raw, b.raw * j / b.j);
    }

    function test_vaultBundleHasNoVote() public {
        MockStock usdg = new MockStock();
        MockVault vault = new MockVault(IERC20(address(usdg)));
        usdg.mint(alice, 1e24);
        vm.startPrank(alice);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(1e24, alice);
        vault.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        (uint8 noVote, uint8 templates) = (gate.NO_VOTE(), gate.ALL_TEMPLATES());
        vm.prank(gov);
        gate.register(address(vault), AssetGate.Class.VAULT4626, noVote, templates);
        actions.sync(address(vault));

        // Reuse the helpers by pointing `stock` at the vault shares.
        stock = MockStock(address(vault));
        Note memory u = _depositNote(R, 5);
        Bundled memory b = _bundle(u, 27);
        assertEq(_unbundle(b.claims, 27).raw, b.raw);
    }

    function test_redeemOnlyAllowsUnbundleNotBundle() public {
        Note memory u = _depositNote(R, 6);
        Bundled memory b = _bundle(u, 31);
        vm.prank(gov);
        gate.setMode(address(stock), AssetGate.Mode.REDEEM_ONLY);

        // Refused before any proof is looked at.
        uint256[5] memory none;
        uint256 root = pool.currentRoot();
        vm.expectRevert(abi.encodeWithSelector(BundleVerifier.AssetNotActive.selector, address(stock)));
        bundler.bundle("", BundleVerifier.Bundle(root, block.timestamp, address(stock), 0, 1, none));

        assertEq(_unbundle(b.claims, 31).raw, b.raw);
    }

    function test_guardianPauseBlocksBundleNotUnbundle() public {
        Note memory u = _depositNote(R, 8);
        Bundled memory b = _bundle(u, 31);
        vm.prank(guardian);
        control.pause(15);

        uint256[5] memory none;
        uint256 root = pool.currentRoot();
        vm.expectRevert(abi.encodeWithSelector(CordonControl.IsPaused.selector, control.BUNDLE()));
        bundler.bundle("", BundleVerifier.Bundle(root, block.timestamp, address(stock), 0, 1, none));

        assertEq(_unbundle(b.claims, 31).raw, b.raw);
    }

    /// Income invariant (spec §6), fuzzed over multiplier paths: after any sequence of
    /// reinvested dividends and one income claim, PRINCIPAL + INCOME == bundle raw ±1.
    function testFuzz_incomeInvariant(uint96 raw, uint16[6] memory steps) public {
        raw = uint96(bound(raw, 1, 2 ** 90));
        (, uint256 jb) = actions.latest(address(stock));
        uint256 m = 1e18;
        for (uint256 i; i < steps.length; ++i) {
            m += m * steps[i] / 1e5; // up to +65% per step
            vm.warp(block.timestamp + 1 days);
            stock.setMultiplier(m);
            vm.prank(keeper);
            actions.confirmStep(address(stock)); // genuine distributions, whatever their size
            actions.sync(address(stock));
        }
        (, uint256 j) = actions.latest(address(stock));
        uint256 income = uint256(raw) * (jb - j) / jb;
        uint256 principal = uint256(raw) * j / jb;
        assertLe(income + principal, raw);
        assertGe(income + principal + 1, raw);
        // Principal's value stays what it was at bundling (raw * 1e18), up to rounding.
        assertApproxEqAbs(principal * m / 1e18, raw, m / 1e18 + 1);
    }

    /// A 2:1 split nobody scheduled is held, not booked: INCOME gets nothing from it,
    /// and a late schedule (at = now) resolves it.
    function test_unscheduledSplitIsHeldNotIncome() public {
        (, uint256 j0) = actions.latest(address(stock));
        vm.warp(block.timestamp + 1 days);
        stock.setMultiplier(2e18);
        actions.sync(address(stock));
        (, uint256 j1) = actions.latest(address(stock));
        assertEq(j1, j0, "held, not booked");

        vm.prank(keeper);
        actions.scheduleSplit(address(stock), 2, 1, uint64(block.timestamp));
        vm.warp(block.timestamp + 1);
        actions.sync(address(stock));
        (, uint256 j2) = actions.latest(address(stock));
        assertEq(j2, j0, "a split is never income");

        // Ordinary income still books after it.
        _dividend(2.02e18);
        (, uint256 j3) = actions.latest(address(stock));
        assertLt(j3, j0);
    }

    /// While income is paused the index is frozen, and unbundle (an exit) still works.
    function test_incomePauseFreezesIndexButNotExit() public {
        Bundled memory b = _bundle(_depositNote(R, 41), 31);
        vm.prank(keeper);
        actions.setIncomePaused(address(stock), true);
        _dividend(1.01e18);
        (, uint256 j) = actions.latest(address(stock));
        assertEq(j, b.j, "frozen while paused");
        _unbundle(b.claims, 31);
        vm.warp(block.timestamp + actions.MAX_INCOME_PAUSE());
        assertFalse(actions.incomePaused(address(stock)), "a pause expires on its own");
    }

    function test_onlyKeeperResolvesSteps() public {
        vm.expectRevert(ActionEngine.NotKeeper.selector);
        actions.confirmStep(address(stock));
        vm.expectRevert(ActionEngine.NotKeeper.selector);
        actions.scheduleSplit(address(stock), 2, 1, uint64(block.timestamp));
        vm.expectRevert(ActionEngine.NotKeeper.selector);
        actions.setIncomePaused(address(stock), true);
    }

    /// Regression (audit-fixes review N1): income claimed past a proof's time cannot be
    /// paid again by unbundling at the older, higher index in force at that time.
    function test_unbundleCannotReuseClaimedIncome() public {
        Bundled memory b = _bundle(_depositNote(R, 51), 31);
        uint256 before = block.timestamp;
        _dividend(1.02e18); // checkpoint after `before`
        (, Note memory next) = _claim(b.claims[1]); // income claimed up to now (past `before`)
        _track(commitOf(next));
        Note[5] memory claims = b.claims;
        claims[1] = next;

        // Dated `before`: index j0 and t_last at bundling, full raw back out.
        string memory toml = string.concat(
            _kv("root", pool.currentRoot()),
            _kv("now", before),
            _kv("asset", uint160(address(stock))),
            _kv("j_now", b.j)
        );
        toml = string.concat(toml, _kv("t_last", b.at), _kv("claim_mask", 31), _kv("sk", sk));
        toml = string.concat(toml, _kv("out_blinding", 778), _kv("out_raw", b.raw));
        toml = string.concat(toml, _claimsToml(claims, 31));
        (int256 code,) = _tryProve("unbundle", toml);
        assertTrue(code != 0, "income claimed past the proof time must not unbundle at the old index");
    }
}
