// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// Robinhood Stock Token scaled-UI extension (1e18 multipliers).
interface IERC8056 {
    /// Multiplier in use now (1e18 = 1x).
    function uiMultiplier() external view returns (uint256);
    /// Multiplier that takes effect at `effectiveAt`.
    function newUIMultiplier() external view returns (uint256);
    /// Time the new multiplier takes effect, or 0 if none is set.
    function effectiveAt() external view returns (uint256);
}

/// Multiplier in force now: `newUIMultiplier` from `effectiveAt` on, whether or not the
/// token has rolled it into `uiMultiplier` yet.
function effectiveMultiplier(IERC8056 token) view returns (uint256) {
    uint256 at = token.effectiveAt();
    return at != 0 && block.timestamp >= at ? token.newUIMultiplier() : token.uiMultiplier();
}
