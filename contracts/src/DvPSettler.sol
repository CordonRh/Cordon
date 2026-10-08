// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CordonControl} from "./CordonControl.sol";
import {CordonPool} from "./CordonPool.sol";
import {PriceOracle} from "./PriceOracle.sol";
import {IProofVerifier} from "./interfaces/IProofVerifier.sol";

/// Sealed multi-leg settlement (spec §3.4). The sequencer collects sealed orders for a
/// 60s batch, pairs them into trades of up to 16 legs and proves each trade. Every order
/// carries its trader's own order proof (spending key, in the browser): it fixes the
/// order's terms (`orderHash`) and proves the nullifiers spent here, so the sequencer
/// never holds a spending key and can only settle orders as placed. Every trade is priced
/// against one table pinned for the whole batch; a stale oracle defers the batch, and a
/// trade whose proofs or notes fail is left out while the rest of the batch settles.
contract DvPSettler {
    uint256 public constant LEGS = 16;
    uint256 public constant PARTIES = 2;
    uint256 public constant GIVES = 8; // per order: LEGS / PARTIES
    uint256 public constant PRICES = 16;
    uint256 public constant MAX_TOLERANCE_BPS = 50;
    uint256 public constant MAX_PROOF_AGE = 5 minutes;

    CordonPool public immutable pool;
    CordonControl public immutable control;
    PriceOracle public immutable oracle;
    IProofVerifier public immutable verifier;
    IProofVerifier public immutable orderVerifier;

    uint256 public batchSeq;

    /// kind 0 (underlying) entries are priced from the oracle at `roundId`; claim
    /// kinds carry the matched `quote` (claims have no market feed).
    struct Price {
        address asset;
        uint8 kind;
        uint80 roundId;
        uint256 quote;
    }

    /// A trader's order proof: the order's terms hash and the nullifiers of its notes.
    struct OrderAuth {
        bytes proof;
        uint256 orderHash;
        uint256[GIVES] nullifiers;
    }

    struct Trade {
        bytes proof;
        uint256 root;
        uint256 toleranceBps;
        OrderAuth[PARTIES] orders;
        uint256[2 * LEGS] commits;
        uint256[LEGS] memos;
    }

    /// Emitted once per batch with the number of settled trades and legs and the price table hash.
    event BatchSettled(uint256 indexed seq, uint256 trades, uint256 legs, bytes32 pricesHash);
    /// Emitted when trade `index` of batch `seq` is left out.
    event TradeExcluded(uint256 indexed seq, uint256 index);
    /// Everything a trader needs to rebuild its new notes without the sequencer: its
    /// order hash finds its side, and `memos[s]` is the amount of give slot s masked by
    /// the receiving order's salt (see circuits/dvp).
    event TradeSettled(
        uint256 indexed seq, uint256 indexed orderHashA, uint256 indexed orderHashB, uint256[LEGS] memos
    );

    error NotSequencer();
    error StaleProof();
    error DuplicatePrice(uint256 index);

    constructor(CordonPool pool_, PriceOracle oracle_, IProofVerifier verifier_, IProofVerifier orderVerifier_) {
        pool = pool_;
        control = pool_.control();
        oracle = oracle_;
        verifier = verifier_;
        orderVerifier = orderVerifier_;
    }

    /// Settles one sealed batch of trades against one pinned price table. Only the sequencer
    /// may call. Oracle prices are per raw unit, 1e27 = 1 USD. Reverts if DvP is paused, `now_`
    /// is not within MAX_PROOF_AGE, or an (asset, kind) price entry repeats. A trade with a bad
    /// proof or a spent note is left out (TradeExcluded); the rest of the batch settles.
    function submitBatch(uint256 now_, Price[PRICES] calldata prices, Trade[] calldata trades) external {
        if (msg.sender != control.sequencer()) revert NotSequencer();
        control.requireActive(control.DVP());
        if (now_ > block.timestamp || now_ + MAX_PROOF_AGE < block.timestamp) revert StaleProof();

        bytes32[] memory pub = new bytes32[](3 + 3 * PRICES + PARTIES + 3 * LEGS);
        pub[1] = bytes32(now_);
        for (uint256 i; i < PRICES; ++i) {
            Price calldata p = prices[i];
            if (p.asset == address(0)) continue;
            // One entry per (asset, kind), and each at the round in force at the batch time:
            // the sequencer cannot offer a choice of marks.
            for (uint256 k; k < i; ++k) {
                if (prices[k].asset == p.asset && prices[k].kind == p.kind) revert DuplicatePrice(i);
            }
            pub[3 + i] = bytes32(uint256(uint160(p.asset)));
            pub[3 + PRICES + i] = bytes32(uint256(p.kind));
            pub[3 + 2 * PRICES + i] = bytes32(p.kind == 0 ? oracle.rawPriceAt(p.asset, p.roundId, now_) : p.quote);
        }

        uint256 seq = batchSeq++;
        uint256 settled;
        uint256 legs;
        for (uint256 t; t < trades.length; ++t) {
            uint256 n = _settle(trades[t], pub);
            if (n == 0) {
                emit TradeExcluded(seq, t);
            } else {
                ++settled;
                legs += n;
                emit TradeSettled(seq, trades[t].orders[0].orderHash, trades[t].orders[1].orderHash, trades[t].memos);
            }
        }
        emit BatchSettled(seq, settled, legs, keccak256(abi.encode(prices)));
    }

    /// Returns the number of legs settled, or 0 if the trade was excluded.
    function _settle(Trade calldata t, bytes32[] memory pub) internal returns (uint256 legCount) {
        if (t.toleranceBps > MAX_TOLERANCE_BPS) return 0;
        pub[0] = bytes32(t.root);
        pub[2] = bytes32(t.toleranceBps);
        uint256 o = 3 + 3 * PRICES;
        uint256[] memory nullifiers = new uint256[](LEGS);
        uint256[] memory commits = new uint256[](2 * LEGS);
        for (uint256 p; p < PARTIES; ++p) {
            OrderAuth calldata a = t.orders[p];
            pub[o + p] = bytes32(a.orderHash);
            bytes32[] memory orderPub = new bytes32[](1 + GIVES);
            orderPub[0] = bytes32(a.orderHash);
            for (uint256 i; i < GIVES; ++i) {
                orderPub[1 + i] = bytes32(a.nullifiers[i]);
                nullifiers[p * GIVES + i] = a.nullifiers[i];
                if (a.nullifiers[i] != 0) ++legCount;
            }
            if (!_verify(orderVerifier, a.proof, orderPub)) return 0;
        }
        for (uint256 i; i < 2 * LEGS; ++i) {
            pub[o + PARTIES + i] = bytes32(t.commits[i]);
            commits[i] = t.commits[i];
        }
        for (uint256 i; i < LEGS; ++i) {
            pub[o + PARTIES + 2 * LEGS + i] = bytes32(t.memos[i]);
        }
        if (!_verify(verifier, t.proof, pub)) return 0;
        // A note already spent (e.g. by another trade in this batch) excludes the trade.
        try pool.applyOp(t.root, nullifiers, commits) {
            return legCount;
        } catch {
            return 0;
        }
    }

    function _verify(IProofVerifier v, bytes calldata proof, bytes32[] memory pub) internal view returns (bool) {
        try v.verify(proof, pub) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
