//! One DvP trade (spec §3.4) between two orders. Each side gives up to 8 notes (part of
//! each, change back to the giver) to the other side. Each order is authorised by its
//! trader's own order proof over `Order::hash`, so the sequencer proves the trade with
//! no spending key and cannot change what was ordered: who receives, what asset and
//! claim class, which notes and amounts, the quotes, the fewest units accepted in
//! return and the expiry. Per side, the value received and given at the batch's
//! reference prices must net to zero within `tolerance_bps`.
//!
//! New notes are blinded from the orders' own secret salts, and every received amount
//! is published masked by the receiver's salt (`memos`), so each trader can rebuild its
//! notes from the chain alone: settlement never depends on the sequencer delivering them.
use cordon::{
    assert_amount, DEPTH, derive, GIVES, INCOME, merkle_root, Order, TAG_CHANGE, TAG_MEMO, TAG_OUT,
    UNDERLYING,
};

global PARTIES: u32 = 2;
global PRICES: u32 = 16;

/// Sequencer-side data for one give: its price table entry and where the note sits.
pub struct Leg {
    price_idx: u8,
    index: Field,
    path: [Field; DEPTH],
}

fn main(
    root: pub Field,
    now: pub Field,
    tolerance_bps: pub Field,
    price_asset: pub [Field; PRICES],
    price_kind: pub [Field; PRICES],
    price: pub [Field; PRICES], // value of one raw unit, 1e27 = 1 USD (PriceOracle.SCALE)
    orders: [Order; PARTIES],
    legs: [[Leg; GIVES]; PARTIES],
) -> pub ([Field; PARTIES], [Field; 2 * PARTIES * GIVES], [Field; PARTIES * GIVES]) {
    tolerance_bps.assert_max_bit_size::<14>();
    let mut given = [0; PARTIES];
    let mut received = [0; PARTIES];
    let mut received_raw = [0; PARTIES];
    let mut commits = [0; 2 * PARTIES * GIVES];
    let mut memos = [0; PARTIES * GIVES];

    for p in 0..PARTIES {
        let o = orders[p];
        let to = 1 - p;
        let r = orders[to];
        assert(o.gives[0].active, "empty order");
        assert(!o.expiry.lt(now), "order expired");
        for i in 0..GIVES {
            let g = o.gives[i];
            if g.active {
                let leg = legs[p][i];
                let n = g.note;
                assert(n.lock == 0, "encumbered");
                if (n.kind == INCOME) & (n.term_until != 0) {
                    assert(!n.term_until.lt(now), "income term expired");
                }
                assert(merkle_root(n.commit(), leg.index, leg.path) == root, "unknown note");
                assert((n.asset == r.want_asset) & (n.kind == r.want_kind), "not what the other side wants");

                let k = leg.price_idx as u32;
                assert(k < PRICES, "bad price index");
                assert((price_asset[k] == n.asset) & (price_kind[k] == n.kind), "leg not priced");
                price[k].assert_max_bit_size::<100>();
                if n.kind != UNDERLYING {
                    // Claims have no feed: both sides agreed to this quote and this exact class.
                    assert((price[k] == g.price_quote) & (price[k] == r.want_quote), "off-quote price");
                    assert(n.class_hash() == r.want_class, "not the claim class wanted");
                }

                assert_amount(n.raw);
                assert_amount(g.amount);
                assert(g.amount != 0, "empty leg");
                assert(!n.raw.lt(g.amount), "amount exceeds note");
                let value = g.amount * price[k];
                given[p] += value;
                received[to] += value;
                received_raw[to] += g.amount;

                let j = (p * GIVES + i) as Field;
                let mut out = n;
                out.raw = g.amount;
                out.owner_pk = r.receive_pk;
                out.blinding = derive(r.salt, j, TAG_OUT);
                let mut change = n;
                change.raw = n.raw - g.amount;
                change.blinding = derive(o.salt, j, TAG_CHANGE);

                let s = p * GIVES + i;
                commits[2 * s] = out.commit();
                commits[2 * s + 1] = if change.raw == 0 { 0 } else { change.commit() };
                memos[s] = g.amount + derive(r.salt, j, TAG_MEMO);
            }
        }
    }

    for p in 0..PARTIES {
        assert(!received_raw[p].lt(orders[p].want_min), "receives less than the order accepts");
        // |received - given| * 10000 <= tolerance_bps * max(received, given)
        let (hi, lo) = if given[p].lt(received[p]) { (received[p], given[p]) } else {
            (given[p], received[p])
        };
        assert(!(tolerance_bps * hi).lt((hi - lo) * 10000), "trade does not net");
    }
    ([orders[0].hash(), orders[1].hash()], commits, memos)
}

// A termed INCOME claim (asset 7) for 100 units of an underlying (asset 9): 10 x 100 = 100 x 10.
#[test]
fn test_claim_class_leg_settles() {
    let (root, prices, orders, legs) = claim_trade();
    let _ = main(root, 1000, 0, prices[0], prices[1], prices[2], orders, legs);
}

// The buyer asked for one claim class; a note of another class (here a shorter term) of the
// same asset and kind at the same quote cannot fill it.
#[test(should_fail_with = "not the claim class wanted")]
fn test_other_claim_class_cannot_fill() {
    let (root, prices, mut orders, legs) = claim_trade();
    let mut other = orders[0].gives[0].note;
    other.term_until = 1500;
    orders[1].want_class = other.class_hash();
    let _ = main(root, 1000, 0, prices[0], prices[1], prices[2], orders, legs);
}

fn claim_trade() -> (Field, [[Field; PRICES]; 3], [Order; PARTIES], [[Leg; GIVES]; PARTIES]) {
    let none = cordon::Note {
        asset: 0, raw: 0, kind: 0, bundle_id: 0, j_bundle: 0, term_from: 0, term_until: 0,
        accrued_to: 0, lock: 0, owner_pk: 0, blinding: 0,
    };
    let claim = cordon::Note {
        asset: 7, raw: 10, kind: INCOME, bundle_id: 55, j_bundle: 1, term_from: 0, term_until: 5000,
        accrued_to: 0, lock: 0, owner_pk: 1, blinding: 2,
    };
    let stock = cordon::Note {
        asset: 9, raw: 100, kind: UNDERLYING, bundle_id: 0, j_bundle: 0, term_from: 0, term_until: 0,
        accrued_to: 0, lock: 0, owner_pk: 3, blinding: 4,
    };
    // Two leaves under one root: each note's sibling is the other, then empty subtrees.
    let mut path_a = [0; DEPTH];
    let mut path_b = [0; DEPTH];
    path_a[0] = stock.commit();
    path_b[0] = claim.commit();
    let root = merkle_root(claim.commit(), 0, path_a);

    let idle = cordon::OrderGive { active: false, note: none, amount: 0, price_quote: 0 };
    let empty_leg = Leg { price_idx: 0, index: 0, path: [0; DEPTH] };
    let mut a = Order {
        gives: [idle; GIVES], want_asset: 9, want_kind: UNDERLYING, want_quote: 0, want_class: 0,
        want_min: 100, receive_pk: 1, expiry: 2000, salt: 11,
    };
    a.gives[0] = cordon::OrderGive { active: true, note: claim, amount: 10, price_quote: 100 };
    let mut b = Order {
        gives: [idle; GIVES], want_asset: 7, want_kind: INCOME, want_quote: 100,
        want_class: claim.class_hash(), want_min: 10, receive_pk: 3, expiry: 2000, salt: 12,
    };
    b.gives[0] = cordon::OrderGive { active: true, note: stock, amount: 100, price_quote: 0 };
    let mut legs = [[empty_leg; GIVES]; PARTIES];
    legs[0][0] = Leg { price_idx: 0, index: 0, path: path_a };
    legs[1][0] = Leg { price_idx: 1, index: 1, path: path_b };

    let mut prices = [[0; PRICES]; 3];
    prices[0][0] = 7;
    prices[1][0] = INCOME;
    prices[2][0] = 100;
    prices[0][1] = 9;
    prices[1][1] = UNDERLYING;
    prices[2][1] = 10;
    (root, prices, [a, b], legs)
}
