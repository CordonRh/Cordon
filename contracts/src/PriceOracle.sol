// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {AssetGate} from "./AssetGate.sol";
import {IERC8056, effectiveMultiplier} from "./interfaces/IERC8056.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// Reference prices per raw unit (1e27 = 1 USD) at a pinned Chainlink round:
/// feed price x uiMultiplier for Stock Tokens, x assets-per-share for ERC-4626 vaults.
/// Fail-closed: a stale or non-positive round reverts, so pricing never uses old marks.
/// Nothing on the withdrawal path reads this contract.
contract PriceOracle is Ownable2Step {
    uint256 public constant SCALE = 1e27;
    uint32 public constant MIN_HEARTBEAT = 1 minutes;
    uint32 public constant MAX_HEARTBEAT = 1 days;

    struct Feed {
        AggregatorV3Interface feed;
        uint32 heartbeat;
    }

    AssetGate public immutable assetGate;
    mapping(address => Feed) public feeds;

    /// Emitted when the owner sets the feed of an asset.
    event FeedSet(address indexed asset, address feed, uint32 heartbeat);

    error NoFeed(address asset);
    error StaleOracle(address asset, uint80 roundId);
    error BadFeed();

    constructor(address owner_, AssetGate assetGate_) Ownable(owner_) {
        assetGate = assetGate_;
    }

    /// For a vault, `feed` prices the vault's underlying asset. A feed's heartbeat is at
    /// most a day: a round older than that is never a fair mark.
    function setFeed(address asset, AggregatorV3Interface feed, uint32 heartbeat) external onlyOwner {
        if (address(feed) == address(0) || heartbeat < MIN_HEARTBEAT || heartbeat > MAX_HEARTBEAT) {
            revert BadFeed();
        }
        feeds[asset] = Feed(feed, heartbeat);
        emit FeedSet(asset, address(feed), heartbeat);
    }

    /// Price per raw unit at `roundId`, which must be the feed's latest round now.
    function rawPrice(address asset, uint80 roundId) external view returns (uint256) {
        return rawPriceAt(asset, roundId, block.timestamp);
    }

    /// Price per raw unit at `roundId`, which must be the round in force at `refTime`
    /// (published at or before it, not yet replaced by then) and fresh now. The caller
    /// cannot pick a better round from the heartbeat window, and a round older than the
    /// asset's latest corporate action (split, reinvested dividend) is refused, so a
    /// pre-action share price is never paired with the post-action multiplier.
    function rawPriceAt(address asset, uint80 roundId, uint256 refTime) public view returns (uint256) {
        Feed memory f = feeds[asset];
        if (address(f.feed) == address(0)) revert NoFeed(asset);
        (, int256 answer,, uint256 updatedAt,) = f.feed.getRoundData(roundId);
        if (answer <= 0 || updatedAt == 0 || updatedAt > refTime || updatedAt + f.heartbeat < block.timestamp) {
            revert StaleOracle(asset, roundId);
        }
        if (_replacedBy(f.feed, roundId, refTime)) revert StaleOracle(asset, roundId);
        uint256 perToken = uint256(answer) * SCALE / 10 ** f.feed.decimals(); // USD per whole token, 1e27

        AssetGate.Class c = assetGate.classOf(asset);
        if (c == AssetGate.Class.VAULT4626) {
            IERC4626 v = IERC4626(asset);
            uint256 oneShare = 10 ** v.decimals();
            uint256 assetUnit = 10 ** IERC20Metadata(v.asset()).decimals();
            return perToken * v.convertToAssets(oneShare) / assetUnit / oneShare;
        }
        uint256 unit = 10 ** IERC20Metadata(asset).decimals();
        if (c == AssetGate.Class.TREASURY) return perToken / unit;
        uint256 actionAt = IERC8056(asset).effectiveAt();
        if (actionAt != 0 && actionAt <= block.timestamp && updatedAt < actionAt) revert StaleOracle(asset, roundId);
        return perToken * effectiveMultiplier(IERC8056(asset)) / 1e18 / unit;
    }

    /// True if `rawPrice(asset, roundId)` succeeds now. It never reverts.
    function ok(address asset, uint80 roundId) external view returns (bool) {
        try this.rawPrice(asset, roundId) returns (uint256) {
            return true;
        } catch {
            return false;
        }
    }

    /// True when a later round was already published at or before `refTime`. Within a
    /// phase that is round `roundId + 1`; across a Chainlink phase change (aggregator
    /// upgrade) the next round has another id, so the latest round decides.
    function _replacedBy(AggregatorV3Interface feed, uint80 roundId, uint256 refTime) internal view returns (bool) {
        try feed.getRoundData(roundId + 1) returns (uint80, int256, uint256, uint256 nextAt, uint80) {
            if (nextAt != 0) return nextAt <= refTime;
        } catch {}
        (uint80 latestId,,, uint256 latestAt,) = feed.latestRoundData();
        return latestId != roundId && latestAt != 0 && latestAt <= refTime;
    }
}
