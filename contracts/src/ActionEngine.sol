// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {AssetGate} from "./AssetGate.sol";
import {CordonControl} from "./CordonControl.sol";
import {IERC8056, effectiveMultiplier} from "./interfaces/IERC8056.sol";

/// Corporate actions -> income index (spec §3.5).
///
/// Raw units never change. Reinvested income shows up as a rising multiplier
/// (ERC-8056 `uiMultiplier`, or ERC-4626 assets per share). The index is
/// j = 1e36 * m0 / m, with m the split-adjusted multiplier and m0 its first value,
/// so j starts at 1e36 for every asset (whatever its units) and only falls. A bundle made at j_b keeps PRINCIPAL backed by raw * j / j_b underlying and
/// pays INCOME raw * (j_start - j_end) / j_b: PRINCIPAL's value (raw * j/j_b * m)
/// stays equal to the value at bundling, and the two always sum to the bundle.
///
/// A multiplier step of more than MAX_STEP_BPS in one sync is held, not booked: it is
/// most likely a split the keeper has not scheduled yet, and booking it would hand
/// PRINCIPAL value to INCOME for good. The keeper resolves it with `scheduleSplit`
/// (a split, from now) or `confirmStep` (a genuine large distribution).
contract ActionEngine {
    uint256 public constant ONE = 1e18;
    uint256 public constant J_SCALE = 1e36;
    uint256 public constant MAX_STEP_BPS = 500;
    uint256 public constant MAX_INCOME_PAUSE = 3 days;

    struct Checkpoint {
        uint64 ts;
        uint192 j;
    }

    struct Split {
        uint128 num; // 2:1 split = num 2, den 1
        uint128 den;
        uint64 at;
    }

    AssetGate public immutable assetGate;
    CordonControl public immutable control;

    mapping(address => Checkpoint[]) internal history;
    mapping(address => uint256) public base; // split-adjusted multiplier at the first sync
    mapping(address => uint256) public splitNum; // cumulative split factor applied so far
    mapping(address => uint256) public splitDen;
    mapping(address => Split) public pendingSplit;
    mapping(address => uint256) public incomePausedUntil;
    mapping(address => uint256) public stepConfirmedUntil; // a confirmation is good for a day

    /// Emitted when the income index of `asset` falls to `j` (1e36 scale) at time `ts`.
    event IndexUpdated(address indexed asset, uint256 ts, uint256 j);
    /// Emitted when a keeper schedules a num:den split of `asset` that starts at `at`.
    event SplitScheduled(address indexed asset, uint256 num, uint256 den, uint256 at);
    /// Emitted when a scheduled split takes effect during a sync.
    event SplitApplied(address indexed asset, uint256 num, uint256 den);
    /// Emitted when a keeper pauses or resumes income booking for `asset`.
    event IncomePaused(address indexed asset, bool paused);
    /// Emitted when a sync holds a multiplier step larger than MAX_STEP_BPS.
    /// `j` is the index in force; `heldJ` is the index that was not booked.
    event StepHeld(address indexed asset, uint256 j, uint256 heldJ);
    /// Emitted when a keeper confirms a held step as a genuine distribution.
    event StepConfirmed(address indexed asset);

    error NotKeeper();
    error UnknownAsset(address asset);
    error NoIndex(address asset, uint256 ts);
    error BadSplit();

    constructor(AssetGate assetGate_, CordonControl control_) {
        assetGate = assetGate_;
        control = control_;
    }

    modifier onlyKeeper() {
        if (!control.isKeeper(msg.sender)) revert NotKeeper();
        _;
    }

    /// Reads the asset's multiplier and appends a checkpoint when income accrued.
    /// Called by the action-watcher every 60s and by engines before they price.
    /// While income is paused the index is frozen: claims and unbundles keep working
    /// against the last checkpoint, and the paused income is booked after the pause.
    function sync(address asset) public returns (uint256 ts, uint256 j) {
        if (!assetGate.isKnown(asset)) revert UnknownAsset(asset);
        if (incomePaused(asset) && history[asset].length != 0) return _last(asset);
        Split memory s = pendingSplit[asset];
        if (s.at != 0 && block.timestamp >= s.at) {
            splitNum[asset] = _factor(splitNum[asset]) * s.num;
            splitDen[asset] = _factor(splitDen[asset]) * s.den;
            delete pendingSplit[asset];
            emit SplitApplied(asset, s.num, s.den);
        }
        uint256 m = multiplier(asset) * _factor(splitDen[asset]) / _factor(splitNum[asset]);
        Checkpoint[] storage h = history[asset];
        uint256 len = h.length;
        // A zero multiplier is a broken asset contract: keep the last index rather than
        // revert, so unbundle (an exit) never depends on it.
        if (m == 0) {
            if (len == 0) revert NoIndex(asset, block.timestamp);
            return _last(asset);
        }
        if (base[asset] == 0) base[asset] = m;
        uint256 next = J_SCALE * base[asset] / m;

        bool confirmed = block.timestamp <= stepConfirmedUntil[asset];
        if (len != 0 && next < h[len - 1].j * (10_000 - MAX_STEP_BPS) / 10_000 && !confirmed) {
            emit StepHeld(asset, h[len - 1].j, next);
            return _last(asset);
        }
        if (len == 0 || next < h[len - 1].j) {
            if (confirmed) delete stepConfirmedUntil[asset];
            // A falling multiplier (no income) never raises j: principal absorbs it.
            if (len != 0 && h[len - 1].ts == block.timestamp) h[len - 1].j = uint192(next);
            else h.push(Checkpoint(uint64(block.timestamp), uint192(next)));
            emit IndexUpdated(asset, block.timestamp, next);
        }
        return _last(asset);
    }

    /// Announced split: from `at` the multiplier jump is a split, not income. `at` may be
    /// now, which also resolves a split that was held because nobody scheduled it in time.
    function scheduleSplit(address asset, uint128 num, uint128 den, uint64 at) external onlyKeeper {
        if (num == 0 || den == 0 || at < block.timestamp) revert BadSplit();
        if (pendingSplit[asset].at != 0) revert BadSplit(); // never overwrite a pending split
        pendingSplit[asset] = Split(num, den, at);
        emit SplitScheduled(asset, num, den, at);
    }

    /// The held step is a genuine distribution: a sync within the next day books it.
    function confirmStep(address asset) external onlyKeeper {
        stepConfirmedUntil[asset] = block.timestamp + 1 days;
        emit StepConfirmed(asset);
    }

    /// Set by the action-watcher when the post-step multiplier disagrees with Chainlink.
    /// Freezes the index for at most MAX_INCOME_PAUSE; nothing is blocked meanwhile.
    function setIncomePaused(address asset, bool paused) external onlyKeeper {
        incomePausedUntil[asset] = paused ? block.timestamp + MAX_INCOME_PAUSE : 0;
        emit IncomePaused(asset, paused);
    }

    /// True while the income pause for `asset` is in force. Anyone may call.
    function incomePaused(address asset) public view returns (bool) {
        return block.timestamp < incomePausedUntil[asset];
    }

    /// The multiplier in force now. ERC-8056 switches to `newUIMultiplier` at
    /// `effectiveAt` whether or not the token has updated `uiMultiplier` yet; TREASURY
    /// assets carry no income multiplier.
    function multiplier(address asset) public view returns (uint256) {
        AssetGate.Class c = assetGate.classOf(asset);
        if (c == AssetGate.Class.VAULT4626) return IERC4626(asset).convertToAssets(ONE);
        if (c == AssetGate.Class.TREASURY) return ONE;
        return effectiveMultiplier(IERC8056(asset));
    }

    /// Returns the newest checkpoint of `asset`: its timestamp and its index j (1e36 scale).
    /// Reverts with NoIndex if the asset has no checkpoint yet.
    function latest(address asset) external view returns (uint256 ts, uint256 j) {
        Checkpoint[] storage h = history[asset];
        if (h.length == 0) revert NoIndex(asset, block.timestamp);
        Checkpoint memory c = h[h.length - 1];
        return (c.ts, c.j);
    }

    /// Index in force at time `ts` (the last checkpoint at or before it).
    function indexAt(address asset, uint256 ts) external view returns (uint256) {
        (, uint256 j) = checkpointAt(asset, ts);
        return j;
    }

    /// The last checkpoint at or before `ts`, as (its timestamp, its index).
    function checkpointAt(address asset, uint256 ts) public view returns (uint256, uint256) {
        Checkpoint[] storage h = history[asset];
        uint256 lo;
        uint256 hi = h.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (h[mid].ts <= ts) lo = mid + 1;
            else hi = mid;
        }
        if (lo == 0) revert NoIndex(asset, ts);
        Checkpoint memory c = h[lo - 1];
        return (c.ts, c.j);
    }

    /// Returns the number of index checkpoints stored for `asset`.
    function checkpointCount(address asset) external view returns (uint256) {
        return history[asset].length;
    }

    function _last(address asset) internal view returns (uint256, uint256) {
        Checkpoint[] storage h = history[asset];
        Checkpoint memory c = h[h.length - 1];
        return (c.ts, c.j);
    }

    function _factor(uint256 f) internal pure returns (uint256) {
        return f == 0 ? 1 : f;
    }
}
