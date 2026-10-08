// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AssetGate} from "./AssetGate.sol";
import {CordonControl} from "./CordonControl.sol";
import {CordonPool} from "./CordonPool.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

/// Encumbrances (spec §3.3): LOCKUP(until), PLEDGE(obligation, ltv, oracle trigger),
/// LIEN(obligation, waterfall). Only commitments, kinds and expiries are public;
/// parties and amounts stay inside the EncumbranceNote.
contract EncumbranceRegistry {
    uint8 public constant LOCKUP = 0;
    uint8 public constant PLEDGE = 1;
    uint8 public constant LIEN = 2;

    CordonPool public immutable pool;
    AssetGate public immutable assetGate;
    CordonControl public immutable control;
    IProofVerifier public immutable encumberVerifier;
    IProofVerifier public immutable unlockVerifier;
    IProofVerifier public immutable enforceVerifier;

    struct Encumbrance {
        bool exists;
        uint8 kind;
        uint64 until;
        uint64 createdBlock;
        bool released;
        bool defaulted;
        bool enforced;
        uint256 releaseHash;
    }

    struct Encumber {
        uint256 root;
        address asset;
        uint8 kind;
        uint64 until;
        uint256 releaseHash;
        uint256 nullifier;
        uint256 lockedCommit;
        uint256 encCommit;
    }

    struct Spend {
        uint256 root;
        uint256 encCommit;
        uint256 nullifier;
        uint256[] commits; // unlock: [free note]; enforce: 4 tranches + residual
    }

    mapping(uint256 => Encumbrance) public encumbrances;
    uint256 public count;

    /// Emitted when a note is encumbered.
    event Encumbered(uint256 indexed encCommit, uint8 kind, uint64 until);
    /// Emitted when the holder releases an encumbrance.
    event Released(uint256 indexed encCommit);
    /// Emitted when a keeper declares a default.
    event Defaulted(uint256 indexed encCommit);
    /// Emitted when a released note is freed.
    event Unlocked(uint256 indexed encCommit);
    /// Emitted when a defaulted note is split to its creditors.
    event Enforced(uint256 indexed encCommit);

    error AssetNotActive(address asset);
    error TemplateNotAllowed(address asset, uint8 kind);
    error Exists();
    error Unknown();
    error NotReleased();
    error NotDefaulted();
    error AlreadySettled();
    error WrongSecret();
    error NotKeeper();
    error InvalidProof();

    constructor(
        CordonPool pool_,
        IProofVerifier encumberVerifier_,
        IProofVerifier unlockVerifier_,
        IProofVerifier enforceVerifier_
    ) {
        pool = pool_;
        assetGate = pool_.assetGate();
        control = pool_.control();
        encumberVerifier = encumberVerifier_;
        unlockVerifier = unlockVerifier_;
        enforceVerifier = enforceVerifier_;
    }

    /// Locks a note under a LOCKUP, PLEDGE or LIEN encumbrance. Anyone with a valid encumber
    /// proof may call. Reverts if encumbering is paused, the asset is not ACTIVE, the template is
    /// not allowed for the asset, the encumbrance already exists, or the proof is invalid.
    function encumber(bytes calldata proof, Encumber calldata e) external {
        control.requireActive(control.ENCUMBER());
        if (!assetGate.isActive(e.asset)) revert AssetNotActive(e.asset);
        (,,, uint8 templates) = assetGate.assets(e.asset);
        if (e.kind > LIEN || (templates >> e.kind) & 1 == 0) revert TemplateNotAllowed(e.asset, e.kind);
        if (encumbrances[e.encCommit].exists) revert Exists();

        bytes32[] memory pub = new bytes32[](8);
        pub[0] = bytes32(e.root);
        pub[1] = bytes32(uint256(uint160(e.asset)));
        pub[2] = bytes32(uint256(e.kind));
        pub[3] = bytes32(uint256(e.until));
        pub[4] = bytes32(e.releaseHash);
        pub[5] = bytes32(e.nullifier);
        pub[6] = bytes32(e.lockedCommit);
        pub[7] = bytes32(e.encCommit);
        if (!encumberVerifier.verify(proof, pub)) revert InvalidProof();

        encumbrances[e.encCommit] =
            Encumbrance(true, e.kind, e.until, uint64(block.number), false, false, false, e.releaseHash);
        ++count;
        pool.applyOp(e.root, _one(e.nullifier), _one(e.lockedCommit));
        emit Encumbered(e.encCommit, e.kind, e.until);
    }

    /// Holder release: reveal the secret whose hash was bound at encumbrance. The holder
    /// creates that secret and gives the owner only its hash, and a declared default
    /// cannot be released, so the owner cannot take a pledged note back.
    function release(uint256 encCommit, uint256 secret) external {
        Encumbrance storage e = _get(encCommit);
        if (e.enforced || e.defaulted) revert AlreadySettled();
        if (pool.hasher().hash_1(secret) != e.releaseHash) revert WrongSecret();
        e.released = true;
        emit Released(encCommit);
    }

    /// encumbrance-keeper: PLEDGE oracle LTV breach or LIEN default on the obligation.
    function declareDefault(uint256 encCommit) external {
        if (!control.isKeeper(msg.sender)) revert NotKeeper();
        Encumbrance storage e = _get(encCommit);
        if (e.kind == LOCKUP || e.released || e.enforced) revert AlreadySettled();
        e.defaulted = true;
        emit Defaulted(encCommit);
    }

    /// Frees a released note back to its owner. Never paused.
    function unlock(bytes calldata proof, Spend calldata s) external {
        if (!isReleased(s.encCommit)) revert NotReleased();
        _spend(unlockVerifier, proof, s, 1);
        emit Unlocked(s.encCommit);
    }

    /// Splits a defaulted note down the waterfall into four tranches and a residual for the owner.
    /// Anyone with a valid enforce proof may call. Reverts if no default was declared, or the
    /// encumbrance was already released or enforced.
    function enforce(bytes calldata proof, Spend calldata s) external {
        Encumbrance storage e = _get(s.encCommit);
        if (!e.defaulted) revert NotDefaulted();
        if (e.released || e.enforced) revert AlreadySettled();
        e.enforced = true;
        _spend(enforceVerifier, proof, s, 5);
        emit Enforced(s.encCommit);
    }

    /// Released by the holder, or a LOCKUP past `until` (release-by-time is never paused).
    function isReleased(uint256 encCommit) public view returns (bool) {
        Encumbrance storage e = encumbrances[encCommit];
        if (!e.exists || e.enforced) return false;
        return e.released || (e.kind == LOCKUP && block.timestamp >= e.until);
    }

    function _spend(IProofVerifier v, bytes calldata proof, Spend calldata s, uint256 outs) internal {
        if (s.commits.length != outs) revert InvalidProof();
        bytes32[] memory pub = new bytes32[](3 + outs);
        pub[0] = bytes32(s.root);
        pub[1] = bytes32(s.encCommit);
        pub[2] = bytes32(s.nullifier);
        for (uint256 i; i < outs; ++i) {
            pub[3 + i] = bytes32(s.commits[i]);
        }
        if (!v.verify(proof, pub)) revert InvalidProof();
        pool.applyOp(s.root, _one(s.nullifier), s.commits);
    }

    function _get(uint256 encCommit) internal view returns (Encumbrance storage e) {
        e = encumbrances[encCommit];
        if (!e.exists) revert Unknown();
    }

    function _one(uint256 x) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }
}
