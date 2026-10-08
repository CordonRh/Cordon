// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// TESTNET ONLY. Chainlink-style feed with an admin-set price. Every `setAnswer` opens a
/// new round, and earlier rounds keep their own time, as on a real feed. The latest
/// round reads as published at most 5 minutes ago, so testnet pricing never goes stale
/// while round pinning (PriceOracle.rawPriceAt) still works as on mainnet.
contract TestnetPriceFeed {
    uint256 internal constant FRESH = 5 minutes;

    address public immutable admin;
    uint80 public latestRound;
    mapping(uint80 => int256) internal answers;
    mapping(uint80 => uint256) internal setAt;

    constructor(int256 answer_, address admin_) {
        admin = admin_;
        _open(answer_);
    }

    /// Returns 8, the decimals of every answer.
    function decimals() external pure returns (uint8) {
        return 8;
    }

    /// Latest answer, for scripts and dashboards.
    function answer() external view returns (int256) {
        return answers[latestRound];
    }

    /// Opens a new round with answer `a`. Only the admin may call.
    function setAnswer(int256 a) external {
        require(msg.sender == admin, "admin only");
        _open(a);
    }

    /// Returns the latest round in Chainlink format.
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return _round(latestRound);
    }

    /// Returns round `id` in Chainlink format. Reverts if the round does not exist.
    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        require(id != 0 && id <= latestRound, "No data present");
        return _round(id);
    }

    function _open(int256 a) internal {
        latestRound += 1;
        answers[latestRound] = a;
        setAt[latestRound] = block.timestamp;
    }

    function _round(uint80 id) internal view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 at = setAt[id];
        if (id == latestRound && block.timestamp > at + FRESH) at = block.timestamp - FRESH;
        return (id, answers[id], at, at, id);
    }
}
