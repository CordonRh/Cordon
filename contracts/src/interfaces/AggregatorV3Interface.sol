// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface AggregatorV3Interface {
    /// Decimals of the answer.
    function decimals() external view returns (uint8);
    /// Latest round of the feed.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    /// Round `roundId` of the feed.
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
