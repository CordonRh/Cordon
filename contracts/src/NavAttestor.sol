// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {CordonPool} from "./CordonPool.sol";
import {PriceOracle} from "./PriceOracle.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

/// Provable NAV without showing holdings (spec §3.6). A registered vault's manager
/// attests each epoch with a proof over the vault's notes at pinned oracle prices.
/// NAV, total shares and the redemption queue are public; holdings and investor
/// positions (NavPosition notes) are not.
contract NavAttestor is Ownable2Step {
    uint256 public constant HOLDINGS = 16;
    uint256 public constant PRICES = 16;
    uint256 public constant EPOCH = 1 hours;
    // ponytail: the queue is USDG (6 decimals) valued at $1; price it from the oracle
    // if a non-USD queue asset is ever registered.
    uint256 public constant USDG_RAW_TO_USD27 = 1e21;

    CordonPool public immutable pool;
    PriceOracle public immutable oracle;
    IProofVerifier public immutable verifier;

    struct Vault {
        address manager;
        uint256 vaultPk; // h1(vault spending key); notes held under it are the vault's
        uint64 epoch;
        uint64 ts;
        uint256 navPerShare18;
        uint256 totalShares;
        uint256 queueUsdg;
        uint256 holdingsRoot;
    }

    struct Attestation {
        uint64 epoch;
        uint256 navPerShare18;
        uint256 totalShares;
        uint256 liabilities; // USD, 1e27 = 1 USD (includes the redemption queue)
        uint256 queueUsdg;
        uint256 root;
        uint256 holdingsRoot;
        uint256[HOLDINGS] nullifiers;
    }

    struct Price {
        address asset;
        uint80 roundId;
    }

    struct Record {
        uint64 ts;
        uint256 navPerShare18;
        uint256 holdingsRoot;
    }

    mapping(bytes32 => Vault) public vaults;
    mapping(bytes32 => mapping(uint64 => Record)) public history;

    /// Emitted when the owner registers or updates a vault.
    event VaultRegistered(bytes32 indexed vaultId, address manager, uint256 vaultPk);
    /// Emitted when a manager attests an epoch. `navPerShare18` has 18 decimals.
    event Attested(
        bytes32 indexed vaultId, uint64 epoch, uint256 navPerShare18, uint256 totalShares, uint256 queueUsdg
    );

    error UnknownVault();
    error NotManager();
    error WrongEpoch();
    error TooEarly();
    error HoldingSpent(uint256 nullifier);
    error DuplicateHolding();
    error DuplicatePrice(uint256 index);
    error LiabilityOmitted();
    error InvalidProof();

    constructor(address owner_, CordonPool pool_, PriceOracle oracle_, IProofVerifier verifier_) Ownable(owner_) {
        pool = pool_;
        oracle = oracle_;
        verifier = verifier_;
    }

    /// Registers vault `vaultId`, or replaces its manager and the key its notes are held under.
    /// Only the owner may call.
    function registerVault(bytes32 vaultId, address manager, uint256 vaultPk) external onlyOwner {
        Vault storage v = vaults[vaultId];
        v.manager = manager;
        v.vaultPk = vaultPk;
        emit VaultRegistered(vaultId, manager, vaultPk);
    }

    /// Records the NAV of vault `vaultId` for its next epoch. Only the vault's manager may call,
    /// at most once per EPOCH. Holdings are priced at the latest oracle round, and `liabilities`
    /// use 1e27 = 1 USD. Reverts if the epoch is wrong, a holding is spent or repeated, a price
    /// repeats or is stale, liabilities omit the queue, the root is unknown, or the proof is invalid.
    function attest(bytes32 vaultId, Attestation calldata a, Price[PRICES] calldata prices, bytes calldata proof)
        external
    {
        Vault storage v = vaults[vaultId];
        if (v.manager == address(0)) revert UnknownVault();
        if (msg.sender != v.manager) revert NotManager();
        if (a.epoch != v.epoch + 1) revert WrongEpoch();
        if (v.ts != 0 && block.timestamp < v.ts + EPOCH) revert TooEarly();
        if (a.liabilities < a.queueUsdg * USDG_RAW_TO_USD27) revert LiabilityOmitted();
        _checkHoldings(a.nullifiers);

        bytes32[] memory pub = new bytes32[](6 + 2 * PRICES + 1 + HOLDINGS);
        pub[0] = bytes32(a.root);
        pub[1] = bytes32(v.vaultPk);
        pub[2] = bytes32(uint256(a.epoch));
        pub[3] = bytes32(a.navPerShare18);
        pub[4] = bytes32(a.totalShares);
        pub[5] = bytes32(a.liabilities);
        for (uint256 i; i < PRICES; ++i) {
            if (prices[i].asset == address(0)) continue;
            // Fail-closed: every holding is marked at the latest round or nothing is
            // attested, and each asset appears once, so the manager cannot pick a mark.
            for (uint256 k; k < i; ++k) {
                if (prices[k].asset == prices[i].asset) revert DuplicatePrice(i);
            }
            pub[6 + i] = bytes32(uint256(uint160(prices[i].asset)));
            pub[6 + PRICES + i] = bytes32(oracle.rawPrice(prices[i].asset, prices[i].roundId));
        }
        pub[6 + 2 * PRICES] = bytes32(a.holdingsRoot);
        for (uint256 i; i < HOLDINGS; ++i) {
            pub[7 + 2 * PRICES + i] = bytes32(a.nullifiers[i]);
        }
        if (!pool.isKnownRoot(a.root)) revert InvalidProof();
        if (!verifier.verify(proof, pub)) revert InvalidProof();

        v.epoch = a.epoch;
        v.ts = uint64(block.timestamp);
        v.navPerShare18 = a.navPerShare18;
        v.totalShares = a.totalShares;
        v.queueUsdg = a.queueUsdg;
        v.holdingsRoot = a.holdingsRoot;
        history[vaultId][a.epoch] = Record(uint64(block.timestamp), a.navPerShare18, a.holdingsRoot);
        emit Attested(vaultId, a.epoch, a.navPerShare18, a.totalShares, a.queueUsdg);
    }

    /// Public queue depth and the earliest time the next epoch can clear it.
    function redeemQueue(bytes32 vaultId) external view returns (uint256 usdg, uint256 estClear) {
        Vault storage v = vaults[vaultId];
        return (v.queueUsdg, v.ts + EPOCH);
    }

    /// Holdings must be distinct notes that are still unspent.
    function _checkHoldings(uint256[HOLDINGS] calldata nullifiers) internal view {
        for (uint256 i; i < HOLDINGS; ++i) {
            uint256 n = nullifiers[i];
            if (n == 0) continue;
            if (pool.nullified(n)) revert HoldingSpent(n);
            for (uint256 j; j < i; ++j) {
                if (nullifiers[j] == n) revert DuplicateHolding();
            }
        }
    }
}
