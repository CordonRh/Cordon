// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ActionEngine} from "./ActionEngine.sol";
import {AssetGate} from "./AssetGate.sol";
import {CordonControl} from "./CordonControl.sol";
import {CordonPool} from "./CordonPool.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

/// Bundle engine (spec §3.2): bundle / unbundle / term, plus INCOME claims against
/// the ActionEngine index. Each call checks its proof's public inputs against
/// on-chain state and hands the note changes to the pool.
contract BundleVerifier {
    uint256 public constant MAX_PROOF_AGE = 1 hours;

    CordonPool public immutable pool;
    AssetGate public immutable assetGate;
    ActionEngine public immutable actions;
    CordonControl public immutable control;
    IProofVerifier public immutable bundleVerifier;
    IProofVerifier public immutable unbundleVerifier;
    IProofVerifier public immutable termVerifier;
    IProofVerifier public immutable incomeVerifier;

    struct Bundle {
        uint256 root;
        uint256 now_;
        address asset;
        uint256 feeRaw;
        uint256 nullifier;
        uint256[5] commits;
    }

    struct Unbundle {
        uint256 root;
        uint256 now_;
        address asset;
        uint256[5] nullifiers;
        uint256 commit;
    }

    struct Term {
        uint256 root;
        uint256 now_;
        uint256 nullifier;
        uint256[2] commits;
    }

    struct Claim {
        uint256 root;
        address asset;
        uint256 tStart;
        uint256 tEnd;
        uint256 nullifier;
        uint256 next;
        uint256 payout;
    }

    /// Emitted when a note is bundled. `feeRaw` is the bundle fee in raw units.
    event Bundled(address indexed asset, uint256 feeRaw);
    /// Emitted when the claim notes of a bundle are recombined.
    event Unbundled(address indexed asset);
    /// Emitted when an INCOME note is split at a term end.
    event Termed();
    /// Emitted when an INCOME note claims its income up to `tEnd`.
    event IncomeClaimed(address indexed asset, uint256 tEnd);

    error AssetNotActive(address asset);
    error UnknownAsset(address asset);
    error StaleProof();
    error InvalidProof();

    constructor(
        CordonPool pool_,
        ActionEngine actions_,
        IProofVerifier bundleVerifier_,
        IProofVerifier unbundleVerifier_,
        IProofVerifier termVerifier_,
        IProofVerifier incomeVerifier_
    ) {
        pool = pool_;
        assetGate = pool_.assetGate();
        control = pool_.control();
        actions = actions_;
        bundleVerifier = bundleVerifier_;
        unbundleVerifier = unbundleVerifier_;
        termVerifier = termVerifier_;
        incomeVerifier = incomeVerifier_;
    }

    /// Splits an underlying note into claim notes (PRINCIPAL, INCOME and the other kinds in the
    /// asset's claim mask). Anyone with a valid bundle proof may call. Reverts if bundling is
    /// paused, the asset is not ACTIVE, the proof time is not within MAX_PROOF_AGE, or the proof is invalid.
    function bundle(bytes calldata proof, Bundle calldata b) external {
        control.requireActive(control.BUNDLE());
        if (!assetGate.isActive(b.asset)) revert AssetNotActive(b.asset);
        _checkFresh(b.now_);
        actions.sync(b.asset);
        // The new INCOME note accrues from now_, so it starts at the index in force then.
        (, uint256 j) = actions.checkpointAt(b.asset, b.now_);

        bytes32[] memory pub = new bytes32[](12);
        pub[0] = bytes32(b.root);
        pub[1] = bytes32(b.now_);
        pub[2] = _field(b.asset);
        pub[3] = bytes32(j);
        pub[4] = bytes32(uint256(assetGate.claimMask(b.asset)));
        pub[5] = bytes32(b.feeRaw);
        pub[6] = bytes32(b.nullifier);
        for (uint256 i; i < 5; ++i) {
            pub[7 + i] = bytes32(b.commits[i]);
        }
        _verify(bundleVerifier, proof, pub);

        pool.applyOp(b.root, _one(b.nullifier), _arr(b.commits));
        if (b.feeRaw != 0) pool.creditFee(b.asset, b.feeRaw);
        emit Bundled(b.asset, b.feeRaw);
    }

    /// Recombines the claim notes of one bundle into an underlying note.
    /// Anyone with a valid unbundle proof may call.
    /// Works in REDEEM_ONLY and under guardian pause: it is part of the exit path.
    function unbundle(bytes calldata proof, Unbundle calldata u) external {
        if (!assetGate.isKnown(u.asset)) revert UnknownAsset(u.asset);
        _checkFresh(u.now_);
        actions.sync(u.asset);
        // Bound to the index in force at the proof's time, so a later checkpoint (a vault
        // whose rate moves every block) cannot invalidate the proof. PRINCIPAL and the
        // claimed INCOME still sum to the bundle: income after `ts` stays with PRINCIPAL.
        (uint256 ts, uint256 j) = actions.checkpointAt(u.asset, u.now_);

        bytes32[] memory pub = new bytes32[](12);
        pub[0] = bytes32(u.root);
        pub[1] = bytes32(u.now_);
        pub[2] = _field(u.asset);
        pub[3] = bytes32(j);
        pub[4] = bytes32(ts);
        pub[5] = bytes32(uint256(assetGate.claimMask(u.asset)));
        for (uint256 i; i < 5; ++i) {
            pub[6 + i] = bytes32(u.nullifiers[i]);
        }
        pub[11] = bytes32(u.commit);
        _verify(unbundleVerifier, proof, pub);

        pool.applyOp(u.root, _arr(u.nullifiers), _one(u.commit));
        emit Unbundled(u.asset);
    }

    /// Splits an open-ended INCOME note into INCOME until a term end and a remainder from it.
    /// Anyone with a valid term proof may call. Reverts if bundling is paused, the proof time is
    /// not within MAX_PROOF_AGE, or the proof is invalid.
    function term(bytes calldata proof, Term calldata t) external {
        control.requireActive(control.BUNDLE());
        _checkFresh(t.now_);
        bytes32[] memory pub = new bytes32[](5);
        pub[0] = bytes32(t.root);
        pub[1] = bytes32(t.now_);
        pub[2] = bytes32(t.nullifier);
        pub[3] = bytes32(t.commits[0]);
        pub[4] = bytes32(t.commits[1]);
        _verify(termVerifier, proof, pub);

        uint256[] memory commits = new uint256[](2);
        commits[0] = t.commits[0];
        commits[1] = t.commits[1];
        pool.applyOp(t.root, _one(t.nullifier), commits);
        emit Termed();
    }

    /// Pays the income an INCOME note accrued from `tStart` to `tEnd` as a new underlying note
    /// (`payout`) and re-issues the INCOME note from `tEnd` (`next`). Anyone with a valid income
    /// proof may call. Reverts if `tEnd` is in the future or the proof is invalid.
    function claimIncome(bytes calldata proof, Claim calldata c) external {
        // No pause check: a paused asset's index is frozen, so claims pay up to the freeze.
        actions.sync(c.asset);
        if (c.tEnd > block.timestamp) revert StaleProof();

        bytes32[] memory pub = new bytes32[](9);
        pub[0] = bytes32(c.root);
        pub[1] = _field(c.asset);
        pub[2] = bytes32(c.tStart);
        pub[3] = bytes32(c.tEnd);
        pub[4] = bytes32(actions.indexAt(c.asset, c.tStart));
        pub[5] = bytes32(actions.indexAt(c.asset, c.tEnd));
        pub[6] = bytes32(c.nullifier);
        pub[7] = bytes32(c.next);
        pub[8] = bytes32(c.payout);
        _verify(incomeVerifier, proof, pub);

        uint256[] memory commits = new uint256[](2);
        commits[0] = c.next;
        commits[1] = c.payout;
        pool.applyOp(c.root, _one(c.nullifier), commits);
        emit IncomeClaimed(c.asset, c.tEnd);
    }

    function _checkFresh(uint256 t) internal view {
        if (t > block.timestamp || t + MAX_PROOF_AGE < block.timestamp) revert StaleProof();
    }

    function _verify(IProofVerifier v, bytes calldata proof, bytes32[] memory pub) internal view {
        if (!v.verify(proof, pub)) revert InvalidProof();
    }

    function _field(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _one(uint256 x) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }

    function _arr(uint256[5] calldata x) internal pure returns (uint256[] memory a) {
        a = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            a[i] = x[i];
        }
    }
}
