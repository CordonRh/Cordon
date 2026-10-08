// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetGate} from "../src/AssetGate.sol";
import {BundleVerifier} from "../src/BundleVerifier.sol";
import {EncumbranceRegistry} from "../src/EncumbranceRegistry.sol";
import {BundleHelpers} from "./BundleVerifier.t.sol";

contract EncumbranceRegistryTest is BundleHelpers {
    EncumbranceRegistry internal registry;
    uint256 internal constant SECRET = 0xC0FFEE;
    uint256 internal lenderPk = 0x1e9d;
    uint256 internal juniorPk = 0x2e9d;

    struct Enc {
        uint256 kind;
        uint256 until;
        uint256 obligation;
        uint256[4] pk;
        uint256[4] cap;
        uint256 releaseHash;
        uint256 claim;
        uint256 blinding;
    }

    function setUp() public override {
        super.setUp();
        registry = new EncumbranceRegistry(pool, _verifier("Encumber"), _verifier("Unlock"), _verifier("Enforce"));
        vm.prank(gov);
        control.setEngine(address(registry), true);
    }

    // ------------------------------------------------------------ helpers

    function _enc(uint256 kind, uint256 until, Note memory claim) internal view returns (Enc memory e) {
        e.kind = kind;
        e.until = until;
        e.obligation = 0x10a4;
        e.pk[0] = lenderPk;
        e.cap[0] = type(uint120).max;
        e.releaseHash = hasher.hash_1(SECRET);
        e.claim = commitOf(claim);
        e.blinding = 0xE1;
    }

    function encCommitOf(Enc memory e) internal view returns (uint256) {
        uint256 w;
        for (uint256 i; i < 4; ++i) {
            w = hasher.hash_3(w, e.pk[i], e.cap[i]);
        }
        return hasher.hash_3(
            hasher.hash_3(e.kind, e.pk[0], e.until),
            hasher.hash_3(e.obligation, w, e.releaseHash),
            hasher.hash_2(e.claim, e.blinding)
        );
    }

    function _encToml(Enc memory e) internal pure returns (string memory t) {
        t = string.concat("{ kind = ", _s(e.kind), ", until = ", _s(e.until));
        t = string.concat(t, ", obligation = ", _s(e.obligation), ", tranche_pk = [");
        for (uint256 i; i < 4; ++i) {
            t = string.concat(t, i == 0 ? "" : ", ", _s(e.pk[i]));
        }
        t = string.concat(t, "], tranche_cap = [");
        for (uint256 i; i < 4; ++i) {
            t = string.concat(t, i == 0 ? "" : ", ", _s(e.cap[i]));
        }
        t = string.concat(t, "], release_hash = ", _s(e.releaseHash), ", claim = ", _s(e.claim));
        t = string.concat(t, ", blinding = ", _s(e.blinding), " }");
    }

    function _encumber(Note memory n, Enc memory e) internal returns (Note memory locked) {
        locked = _copy(n);
        locked.lock = encCommitOf(e);
        locked.blinding = n.blinding + 9000;
        string memory t = string.concat(_kv("root", pool.currentRoot()), _kv("asset", n.asset), _kv("kind", e.kind));
        t = string.concat(t, _kv("until", e.until), _kv("release_hash", e.releaseHash), _kv("sk", sk));
        t = string.concat(t, "note = ", _noteToml(n), "\n");
        t = string.concat(t, _witness(n, "index", "path"), "enc = ", _encToml(e));
        t = string.concat(t, "\n", _kv("locked_blinding", locked.blinding));

        (bytes memory proof, bytes32[] memory pub) = _prove("encumber", t);
        assertEq(_u(pub[6]), commitOf(locked), "locked commit");
        assertEq(_u(pub[7]), locked.lock, "enc commit");
        registry.encumber(
            proof,
            EncumbranceRegistry.Encumber(
                _u(pub[0]),
                address(uint160(n.asset)),
                uint8(e.kind),
                uint64(e.until),
                e.releaseHash,
                _u(pub[5]),
                _u(pub[6]),
                _u(pub[7])
            )
        );
        _track(_u(pub[6]));
    }

    function _spendToml(Note memory locked, Enc memory e, string memory tail) internal view returns (string memory t) {
        t = string.concat(_kv("root", pool.currentRoot()), _kv("enc_commit", locked.lock));
        t = string.concat(t, "note = ", _noteToml(locked), "\n", _witness(locked, "index", "path"));
        t = string.concat(t, "enc = ", _encToml(e), "\n", tail);
    }

    function _unlockProof(Note memory locked, Enc memory e)
        internal
        returns (bytes memory proof, EncumbranceRegistry.Spend memory s, Note memory free)
    {
        free = _copy(locked);
        free.lock = 0;
        free.blinding = hasher.hash_3(e.blinding, 5, 0); // derived in-circuit from enc.blinding
        bytes32[] memory pub;
        (proof, pub) = _prove("unlock", _spendToml(locked, e, ""));
        s.root = _u(pub[0]);
        s.encCommit = _u(pub[1]);
        s.nullifier = _u(pub[2]);
        s.commits = new uint256[](1);
        s.commits[0] = _u(pub[3]);
        assertEq(s.commits[0], commitOf(free));
    }

    function _enforceProof(Note memory locked, Enc memory e)
        internal
        returns (bytes memory proof, EncumbranceRegistry.Spend memory s)
    {
        bytes32[] memory pub;
        (proof, pub) = _prove("enforce", _spendToml(locked, e, ""));
        s.root = _u(pub[0]);
        s.encCommit = _u(pub[1]);
        s.nullifier = _u(pub[2]);
        s.commits = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            s.commits[i] = _u(pub[3 + i]);
        }
    }

    // ------------------------------------------------------------ tests

    function test_encumberedClaimCannotTransferOrUnbundle() public {
        Bundled memory b = _bundle(_depositNote(R, 1), 31);
        Note memory principal = b.claims[0];
        Note memory locked = _encumber(principal, _enc(1, 0, principal));
        assertEq(registry.count(), 1);

        Note memory out = _copy(locked);
        out.ownerPk = lenderPk;
        (int256 code,) = _tryProve("transfer", _transferToml(locked, _note(0, 70), out, _note(0, 71), 0, address(0)));
        assertTrue(code != 0, "transfer of an encumbered claim");

        Note[5] memory claims = b.claims;
        claims[0] = locked;
        (code,) = _tryProve("unbundle", _unbundleToml(claims, 31, b.raw));
        assertTrue(code != 0, "unbundle with an encumbered claim");

        // The free PRINCIPAL it replaced is spent, so the old set cannot unbundle either.
        claims[0] = principal;
        (bytes memory proof, bytes32[] memory pub) = _prove("unbundle", _unbundleToml(claims, 31, b.raw));
        uint256[5] memory nullifiers;
        for (uint256 k; k < 5; ++k) {
            nullifiers[k] = _u(pub[6 + k]);
        }
        vm.expectRevert();
        bundler.unbundle(
            proof, BundleVerifier.Unbundle(_u(pub[0]), _u(pub[1]), address(stock), nullifiers, _u(pub[11]))
        );
    }

    function test_lockupReleasesAtUntil() public {
        Note memory n = _depositNote(R, 2);
        uint256 until = block.timestamp + 30 days;
        Enc memory e = _enc(0, until, n);
        Note memory locked = _encumber(n, e);

        (bytes memory proof, EncumbranceRegistry.Spend memory s, Note memory free) = _unlockProof(locked, e);
        vm.expectRevert(EncumbranceRegistry.NotReleased.selector);
        registry.unlock(proof, s);

        vm.warp(until);
        vm.prank(guardian);
        control.pause(15); // release-by-time ignores the guardian
        registry.unlock(proof, s);
        _track(s.commits[0]);
        assertEq(free.lock, 0);
    }

    function test_pledgeReleasedByHolderSecret() public {
        Note memory n = _depositNote(R, 3);
        Enc memory e = _enc(1, 0, n);
        Note memory locked = _encumber(n, e);

        vm.expectRevert(EncumbranceRegistry.WrongSecret.selector);
        registry.release(locked.lock, SECRET + 1);
        registry.release(locked.lock, SECRET);

        (bytes memory proof, EncumbranceRegistry.Spend memory s,) = _unlockProof(locked, e);
        registry.unlock(proof, s);
    }

    function test_pledgeEnforceNeedsDefault() public {
        Note memory n = _depositNote(R, 4);
        Enc memory e = _enc(1, 0, n);
        Note memory locked = _encumber(n, e);
        (bytes memory proof, EncumbranceRegistry.Spend memory s) = _enforceProof(locked, e);

        vm.expectRevert(EncumbranceRegistry.NotDefaulted.selector);
        registry.enforce(proof, s);

        vm.expectRevert(EncumbranceRegistry.NotKeeper.selector);
        registry.declareDefault(locked.lock);
        vm.prank(keeper);
        registry.declareDefault(locked.lock);
        registry.enforce(proof, s);

        Note memory toLender = _copy(locked);
        toLender.lock = 0;
        toLender.ownerPk = lenderPk;
        toLender.blinding = hasher.hash_3(e.blinding, 0, 0);
        assertEq(s.commits[0], commitOf(toLender), "whole note re-keyed to the lender");
        assertEq(s.commits[4], 0, "nothing left for the owner");
        assertFalse(registry.isReleased(locked.lock));
    }

    function test_lienWaterfallOrder() public {
        Note memory n = _depositNote(1000, 5);
        Enc memory e = _enc(2, 0, n);
        e.cap[0] = 300;
        e.pk[1] = juniorPk;
        e.cap[1] = 500;
        Note memory locked = _encumber(n, e);
        vm.prank(keeper);
        registry.declareDefault(locked.lock);
        (bytes memory proof, EncumbranceRegistry.Spend memory s) = _enforceProof(locked, e);
        registry.enforce(proof, s);

        uint256[3] memory raws = [uint256(300), 500, 200];
        uint256[3] memory pks = [lenderPk, juniorPk, ownerPk];
        uint256[3] memory slots = [uint256(0), 1, 4];
        for (uint256 i; i < 3; ++i) {
            Note memory o = _copy(locked);
            o.lock = 0;
            o.raw = raws[i];
            o.ownerPk = pks[i];
            o.blinding = hasher.hash_3(e.blinding, slots[i], 0);
            assertEq(s.commits[slots[i]], commitOf(o), "tranche order");
        }
    }

    function test_templateMustBeAllowed() public {
        vm.prank(gov);
        gate.setTemplates(address(stock), 1); // LOCKUP only
        EncumbranceRegistry.Encumber memory e;
        e.asset = address(stock);
        e.kind = 1;
        vm.expectRevert(abi.encodeWithSelector(EncumbranceRegistry.TemplateNotAllowed.selector, address(stock), 1));
        registry.encumber("", e);
    }

    /// The owner cannot release a pledge once a default is declared, so the holder's
    /// enforce always wins.
    function test_releaseAfterDefaultIsRefused() public {
        Note memory n = _depositNote(R, 6);
        Enc memory e = _enc(1, 0, n);
        Note memory locked = _encumber(n, e);
        vm.prank(keeper);
        registry.declareDefault(locked.lock);
        vm.expectRevert(EncumbranceRegistry.AlreadySettled.selector);
        registry.release(locked.lock, SECRET);
        (bytes memory proof, EncumbranceRegistry.Spend memory s) = _enforceProof(locked, e);
        registry.enforce(proof, s);
    }

    /// A zero-raw note carrying the lock cannot be made (empty transfer outputs get no
    /// leaf) and could not be enforced, so a decoy cannot settle the encumbrance.
    function test_zeroRawDecoyCannotEnforce() public {
        Note memory n = _depositNote(R, 8);
        Enc memory e = _enc(1, 0, n);
        Note memory locked = _encumber(n, e);

        Note memory decoy = _note(0, 77);
        decoy.lock = locked.lock;
        Note memory a = _depositNote(500, 78);
        (, bytes32[] memory pub) = _prove("transfer", _transferToml(a, _note(0, 79), _note(500, 80), decoy, 0, address(0)));
        assertEq(_u(pub[8]), 0, "an empty output is not a leaf");

        leaves.push(commitOf(decoy)); // even if it were in the tree
        (int256 code,) = _tryProve("enforce", _spendToml(decoy, e, ""));
        assertTrue(code != 0, "an empty note cannot be enforced");
    }
}
