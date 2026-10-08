// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AssetGate} from "./AssetGate.sol";
import {CordonPool} from "./CordonPool.sol";

/// Hourly per-asset solvency record (spec §6): the pool's token balance must cover
/// every raw unit owed to notes, pending deposits and uncollected fees. The circuits
/// conserve raw units, so `owed` is an upper bound on live claims; a deficit means
/// tokens left the pool some other way, and the attestation fails.
contract SolvencyVerifier {
    uint256 public constant EPOCH = 1 hours;

    CordonPool public immutable pool;
    AssetGate public immutable assetGate;

    struct Record {
        uint64 epoch;
        uint64 ts;
        uint256 poolBalance;
        uint256 liveClaims;
    }

    mapping(address => Record) public latest;

    /// Emitted when an asset passes its solvency check for an epoch.
    event Solvent(address indexed asset, uint64 epoch, uint256 poolBalance, uint256 liveClaims);

    error Deficit(address asset, uint256 poolBalance, uint256 liveClaims);
    error TooEarly();
    error UnknownAsset(address asset);

    constructor(CordonPool pool_) {
        pool = pool_;
        assetGate = pool_.assetGate();
    }

    /// Anyone (normally the solvency cron) may call once per epoch per asset.
    function attest(address asset) external returns (Record memory r) {
        if (!assetGate.isKnown(asset)) revert UnknownAsset(asset);
        Record memory prev = latest[asset];
        if (prev.ts != 0 && block.timestamp < prev.ts + EPOCH) revert TooEarly();
        uint256 balance = IERC20(asset).balanceOf(address(pool));
        uint256 claims = pool.owed(asset) + pool.fees(asset);
        if (balance < claims) revert Deficit(asset, balance, claims);
        r = Record(prev.epoch + 1, uint64(block.timestamp), balance, claims);
        latest[asset] = r;
        emit Solvent(asset, r.epoch, balance, claims);
    }
}
