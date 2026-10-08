// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {AssetGate} from "./AssetGate.sol";
import {CordonControl} from "./CordonControl.sol";
import {ScreeningGate} from "./ScreeningGate.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";
import {Poseidon} from "./libraries/Poseidon.sol";

/// Immutable multi-asset note pool (spec §3.1). Holds every deposited token in raw
/// units, the note tree and the nullifier set. It has no owner and no admin
/// functions: exits (`transact` withdrawals, `unshieldToOrigin`) can never be paused.
/// Servicing engines registered in CordonControl (behind the timelock) may spend
/// and create notes after verifying their own proofs.
contract CordonPool is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Poseidon for IPoseidon2;

    uint256 public constant DEPTH = 32;
    uint256 public constant ROOT_HISTORY = 100;
    uint256 public constant STANDBY = 15 minutes;
    uint256 public constant MAX_PROOF_AGE = 1 hours;
    uint256 internal constant MAX_RAW = 2 ** 120;

    IPoseidon2 public immutable hasher;
    AssetGate public immutable assetGate;
    CordonControl public immutable control;
    ScreeningGate public immutable screening;
    IProofVerifier public immutable transferVerifier;
    uint256 internal immutable emptyMeta; // h3(0,0,0): kind/bundle/index of an underlying note
    uint256 internal immutable emptyTail; // h2(h3(0,0,0), 0): no term, no lock

    struct Deposit {
        address origin;
        address asset;
        uint128 raw;
        uint64 at;
        bool settled; // inserted into the tree or returned to origin
        uint256 commit;
    }

    struct Transfer {
        uint256 root;
        uint256 now_;
        address asset;
        uint256 withdrawRaw;
        address recipient;
        uint256[2] nullifiers;
        uint256[2] commits;
    }

    Deposit[] public deposits;
    mapping(uint256 => bool) public nullified;
    mapping(address => uint256) public fees;
    /// Raw units owed to notes and pending deposits, per asset. Solvency is
    /// balanceOf(pool) >= owed + fees (SolvencyVerifier).
    mapping(address => uint256) public owed;

    uint256[DEPTH] internal zeros;
    uint256[DEPTH] internal filled;
    uint256[ROOT_HISTORY] public roots;
    uint256 public rootIndex;
    uint256 public nextLeaf;

    /// Emitted when a deposit is queued. It may enter the tree from `standbyUntil`.
    event Deposited(
        uint256 indexed depositId, address indexed asset, uint256 raw, uint256 commit, uint256 standbyUntil
    );
    /// Emitted when a deposit goes back to its depositor.
    event Returned(uint256 indexed depositId);
    /// Emitted for each commitment added to the tree, with the root after it.
    event Inserted(uint256 indexed leaf, uint256 commit, uint256 root);
    /// Emitted when a note is spent.
    event Nullified(uint256 nullifier);
    /// Emitted when underlying tokens leave the pool through `transact`.
    event Withdrawn(address indexed asset, uint256 raw);
    /// Emitted when an engine books a fee.
    event FeeCredited(address indexed asset, uint256 raw);
    /// Emitted when fees are sent to the fee recipient.
    event FeesCollected(address indexed asset, uint256 raw, address to);

    error AssetNotActive(address asset);
    error BadAmount();
    error NotField();
    error UnknownRoot();
    error StaleProof();
    error Spent(uint256 nullifier);
    error InvalidProof();
    error NotEngine();
    error DepositSettled(uint256 depositId);
    error InStandby(uint256 depositId);
    error DepositFlagged(uint256 depositId);
    error TreeFull();
    error NoFeeRecipient();
    error NotOrigin(uint256 depositId);

    constructor(
        IPoseidon2 hasher_,
        AssetGate assetGate_,
        CordonControl control_,
        ScreeningGate screening_,
        IProofVerifier transferVerifier_
    ) {
        hasher = hasher_;
        assetGate = assetGate_;
        control = control_;
        screening = screening_;
        transferVerifier = transferVerifier_;
        uint256 z;
        for (uint256 i; i < DEPTH; ++i) {
            zeros[i] = z;
            filled[i] = z;
            z = hasher_.h2(z, z);
        }
        roots[0] = z;
        uint256 zero3 = hasher_.h3(0, 0, 0);
        emptyMeta = zero3;
        emptyTail = hasher_.h2(zero3, 0);
    }

    // ---------------------------------------------------------------- deposits

    /// Takes `raw` units of `asset` and queues an UnderlyingNote for the note key
    /// `npk = h2(owner_pk, blinding)`. It enters the tree after the standby.
    function deposit(address asset, uint256 raw, uint256 npk) external nonReentrant returns (uint256 depositId) {
        control.requireActive(control.DEPOSITS());
        if (!assetGate.isActive(asset)) revert AssetNotActive(asset);
        if (raw == 0 || raw >= MAX_RAW) revert BadAmount();
        if (npk >= Poseidon.FIELD) revert NotField();

        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), raw);
        if (IERC20(asset).balanceOf(address(this)) - before != raw) revert BadAmount();

        owed[asset] += raw;
        uint256 commit = hasher.h3(hasher.h3(npk, uint160(asset), raw), emptyMeta, emptyTail);
        depositId = deposits.length;
        deposits.push(Deposit(msg.sender, asset, uint128(raw), uint64(block.timestamp), false, commit));
        emit Deposited(depositId, asset, raw, commit, block.timestamp + STANDBY);
    }

    /// Moves deposits whose standby passed unflagged into the note tree. Anyone may call.
    /// Ids already settled (returned or inserted) are skipped, so one cannot sink a batch.
    function clear(uint256[] calldata depositIds) external {
        uint256 node;
        for (uint256 i; i < depositIds.length; ++i) {
            uint256 id = depositIds[i];
            Deposit storage d = deposits[id];
            if (d.settled) continue;
            if (block.timestamp < d.at + STANDBY) revert InStandby(id);
            if (screening.flagged(id)) revert DepositFlagged(id);
            d.settled = true;
            node = _insert(d.commit);
        }
        if (node != 0) _pushRoot(node);
    }

    /// Lets the depositor take back a deposit that has not entered the tree (in standby
    /// or flagged). Never paused, whatever the asset's mode.
    function unshieldToOrigin(uint256 depositId) external nonReentrant {
        Deposit storage d = deposits[depositId];
        if (msg.sender != d.origin) revert NotOrigin(depositId);
        if (d.settled) revert DepositSettled(depositId);
        d.settled = true;
        owed[d.asset] -= d.raw;
        IERC20(d.asset).safeTransfer(d.origin, d.raw);
        emit Returned(depositId);
    }

    // ---------------------------------------------------------------- notes

    /// Join-split over notes of one class; with `withdrawRaw` > 0 it releases
    /// underlying tokens to `recipient` (bound in the proof). Never paused.
    function transact(bytes calldata proof, Transfer calldata t) external nonReentrant {
        _checkRoot(t.root);
        if (t.now_ > block.timestamp || t.now_ + MAX_PROOF_AGE < block.timestamp) revert StaleProof();
        bytes32[] memory pub = new bytes32[](9);
        pub[0] = bytes32(t.root);
        pub[1] = bytes32(t.now_);
        pub[2] = bytes32(uint256(uint160(t.asset)));
        pub[3] = bytes32(t.withdrawRaw);
        pub[4] = bytes32(uint256(uint160(t.recipient)));
        pub[5] = bytes32(t.nullifiers[0]);
        pub[6] = bytes32(t.nullifiers[1]);
        pub[7] = bytes32(t.commits[0]);
        pub[8] = bytes32(t.commits[1]);
        if (!transferVerifier.verify(proof, pub)) revert InvalidProof();

        _nullify(t.nullifiers[0]);
        _nullify(t.nullifiers[1]);
        // Empty outputs carry commit 0 and take no leaf, so a full withdrawal needs no tree space.
        uint256 node;
        if (t.commits[0] != 0) node = _insert(t.commits[0]);
        if (t.commits[1] != 0) node = _insert(t.commits[1]);
        if (node != 0) _pushRoot(node);
        if (t.withdrawRaw != 0) {
            owed[t.asset] -= t.withdrawRaw;
            IERC20(t.asset).safeTransfer(t.recipient, t.withdrawRaw);
            emit Withdrawn(t.asset, t.withdrawRaw);
        }
    }

    // ---------------------------------------------------------------- engines

    modifier onlyEngine() {
        if (!control.isEngine(msg.sender)) revert NotEngine();
        _;
    }

    /// Spends and creates notes for a servicing engine that has verified its proof.
    /// Zero entries are skipped (masked claim slots).
    function applyOp(uint256 root, uint256[] calldata nullifiers, uint256[] calldata commits) external onlyEngine {
        _checkRoot(root);
        for (uint256 i; i < nullifiers.length; ++i) {
            if (nullifiers[i] != 0) _nullify(nullifiers[i]);
        }
        uint256 node;
        for (uint256 i; i < commits.length; ++i) {
            if (commits[i] != 0) node = _insert(commits[i]);
        }
        if (node != 0) _pushRoot(node);
    }

    /// Moves `raw` units of `asset` from owed to fees. Only a registered engine may call.
    function creditFee(address asset, uint256 raw) external onlyEngine {
        owed[asset] -= raw;
        fees[asset] += raw;
        emit FeeCredited(asset, raw);
    }

    /// Sends accrued fees to the fee recipient (CrdnStaking). Anyone may call; until a
    /// recipient is set, fees stay in the pool.
    function collectFees(address asset) external nonReentrant {
        address to = control.feeRecipient();
        if (to == address(0)) revert NoFeeRecipient();
        uint256 raw = fees[asset];
        fees[asset] = 0;
        IERC20(asset).safeTransfer(to, raw);
        emit FeesCollected(asset, raw, to);
    }

    // ---------------------------------------------------------------- views

    /// True if `root` is one of the last ROOT_HISTORY tree roots. Zero is never a known root.
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        for (uint256 i; i < ROOT_HISTORY; ++i) {
            if (roots[i] == root) return true;
        }
        return false;
    }

    /// Returns the newest tree root.
    function currentRoot() external view returns (uint256) {
        return roots[rootIndex];
    }

    /// Returns the number of deposits ever made.
    function depositCount() external view returns (uint256) {
        return deposits.length;
    }

    // ---------------------------------------------------------------- internal

    function _checkRoot(uint256 root) internal view {
        if (!isKnownRoot(root)) revert UnknownRoot();
    }

    function _nullify(uint256 n) internal {
        if (nullified[n]) revert Spent(n);
        nullified[n] = true;
        emit Nullified(n);
    }

    // ponytail: one Poseidon2 call per level (32 per insert); batch inserts if gas bites.
    /// Appends a leaf and returns the new root. The caller records it once per call
    /// (`_pushRoot`), so the root history spans calls, not leaves.
    function _insert(uint256 leaf) internal returns (uint256) {
        if (leaf >= Poseidon.FIELD) revert NotField();
        uint256 index = nextLeaf;
        if (index >= 2 ** DEPTH) revert TreeFull();
        nextLeaf = index + 1;
        uint256 node = leaf;
        for (uint256 i; i < DEPTH; ++i) {
            if (index & 1 == 0) {
                filled[i] = node;
                node = hasher.h2(node, zeros[i]);
            } else {
                node = hasher.h2(filled[i], node);
            }
            index >>= 1;
        }
        emit Inserted(nextLeaf - 1, leaf, node);
        return node;
    }

    function _pushRoot(uint256 node) internal {
        rootIndex = (rootIndex + 1) % ROOT_HISTORY;
        roots[rootIndex] = node;
    }
}
