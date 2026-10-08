// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC8056, effectiveMultiplier} from "./interfaces/IERC8056.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// Chainlink's Robinhood feeds report the token's total-return price, which already
/// includes the ERC-8056 multiplier (equity price x uiMultiplier). PriceOracle applies the
/// multiplier itself, so it is given this adapter instead of the feed: every answer is
/// divided by the multiplier in force, and PriceOracle's multiplication restores the feed's
/// per-token price. Rounds, timestamps and decimals pass through unchanged, so the oracle's
/// staleness and corporate-action checks still see the real feed.
contract PerShareFeed is AggregatorV3Interface {
    AggregatorV3Interface public immutable feed;
    IERC8056 public immutable token;

    constructor(AggregatorV3Interface feed_, IERC8056 token_) {
        feed = feed_;
        token = token_;
    }

    /// Decimals of the wrapped feed.
    function decimals() external view returns (uint8) {
        return feed.decimals();
    }

    /// The wrapped feed's latest round, answer divided by the multiplier.
    function latestRoundData() external view returns (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredIn) {
        (id, answer, startedAt, updatedAt, answeredIn) = feed.latestRoundData();
        answer = _perShare(answer);
    }

    /// The wrapped feed's round `roundId`, answer divided by the multiplier.
    function getRoundData(uint80 roundId) external view returns (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredIn) {
        (id, answer, startedAt, updatedAt, answeredIn) = feed.getRoundData(roundId);
        answer = _perShare(answer);
    }

    /// A zero multiplier reverts (division by zero), so the oracle fails closed.
    function _perShare(int256 answer) internal view returns (int256) {
        return answer * 1e18 / int256(effectiveMultiplier(token));
    }
}
