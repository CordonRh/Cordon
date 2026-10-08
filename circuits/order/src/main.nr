//! order (spec §3.4): a trader authorises one DvP order with its spending key, in its
//! own browser. The sequencer proves the trade against `order.hash()` without any key,
//! and the settler spends the notes with the nullifiers proven here, so the sequencer
//! can settle the order as placed or not at all. Spending a note elsewhere cancels it.
use cordon::{assert_amount, GIVES, h1, Order};

fn main(sk: Field, order: Order) -> pub (Field, [Field; GIVES]) {
    let pk = h1(sk);
    // The dvp circuit reads gives in order and needs the first one: no gaps, none empty.
    assert(order.gives[0].active, "empty order");
    for i in 1..GIVES {
        if order.gives[i].active {
            assert(order.gives[i - 1].active, "gives must come first");
        }
    }
    let mut nullifiers = [0; GIVES];
    for i in 0..GIVES {
        let g = order.gives[i];
        if g.active {
            assert(g.note.owner_pk == pk, "not owner");
            // A trade that cannot be proven must not get an order proof: it would stall batches.
            assert(g.note.lock == 0, "encumbered");
            assert_amount(g.note.raw);
            assert_amount(g.amount);
            assert(g.amount != 0, "empty give");
            assert(!g.note.raw.lt(g.amount), "amount exceeds note");
            nullifiers[i] = g.note.nullifier(sk);
        }
    }
    (order.hash(), nullifiers)
}

#[test]
fn test_order_proves_nullifiers_for_owned_notes() {
    let sk = 42;
    let mut order = empty_order();
    order.gives[0].active = true;
    order.gives[0].note.owner_pk = h1(sk);
    order.gives[0].note.raw = 5;
    order.gives[0].amount = 5;
    let (h, n) = main(sk, order);
    assert(h == order.hash());
    assert(n[0] == order.gives[0].note.nullifier(sk));
    assert(n[1] == 0);
}

#[test(should_fail_with = "not owner")]
fn test_order_rejects_someone_elses_note() {
    let mut order = empty_order();
    order.gives[0].active = true;
    order.gives[0].note.owner_pk = h1(1);
    let _ = main(2, order);
}

#[test]
fn test_order_hash_binds_terms() {
    let a = empty_order();
    let mut b = a;
    b.receive_pk = 1;
    assert(a.hash() != b.hash());
}

#[test]
fn test_order_hash_ignores_inactive_gives() {
    let a = empty_order();
    let mut b = a;
    b.gives[3].amount = 9;
    assert(a.hash() == b.hash());
}

fn empty_order() -> Order {
    let note = cordon::Note {
        asset: 0, raw: 0, kind: 0, bundle_id: 0, j_bundle: 0, term_from: 0, term_until: 0,
        accrued_to: 0, lock: 0, owner_pk: 0, blinding: 0,
    };
    let g = cordon::OrderGive { active: false, note, amount: 0, price_quote: 0 };
    Order {
        gives: [g; GIVES], want_asset: 0, want_kind: 0, want_quote: 0, want_class: 0, want_min: 0,
        receive_pk: 0, expiry: 0, salt: 0,
    }
}

#[test(should_fail_with = "amount exceeds note")]
fn test_order_rejects_give_above_note() {
    let sk = 42;
    let mut order = empty_order();
    order.gives[0].active = true;
    order.gives[0].note.owner_pk = h1(sk);
    order.gives[0].note.raw = 5;
    order.gives[0].amount = 6;
    let _ = main(sk, order);
}

#[test(should_fail_with = "encumbered")]
fn test_order_rejects_locked_note() {
    let sk = 42;
    let mut order = empty_order();
    order.gives[0].active = true;
    order.gives[0].note.owner_pk = h1(sk);
    order.gives[0].note.raw = 5;
    order.gives[0].note.lock = 9;
    order.gives[0].amount = 5;
    let _ = main(sk, order);
}

#[test(should_fail_with = "gives must come first")]
fn test_order_rejects_gap_in_gives() {
    let sk = 42;
    let mut order = empty_order();
    order.gives[0].active = true;
    order.gives[0].note.owner_pk = h1(sk);
    order.gives[0].note.raw = 5;
    order.gives[0].amount = 5;
    order.gives[2] = order.gives[0];
    let _ = main(sk, order);
}
