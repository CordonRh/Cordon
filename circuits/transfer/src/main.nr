//! Join-split (spec §3.1 `transact` / `withdraw`, §3.2 `split`): two notes of one
//! class in, two out, optionally releasing underlying raw units to `recipient`.
use cordon::{assert_amount, assert_spendable, DEPTH, INCOME, Note, UNDERLYING};

fn main(
    root: pub Field,
    now: pub Field,
    asset: pub Field, // asset of the withdrawal; ignored when withdraw_raw == 0
    withdraw_raw: pub Field,
    recipient: pub Field, // bound into the proof so a relayer cannot redirect it
    sk: Field,
    ins: [Note; 2],
    in_index: [Field; 2],
    in_path: [[Field; DEPTH]; 2],
    outs: [Note; 2],
) -> pub ([Field; 2], [Field; 2]) {
    let _ = recipient;
    let class = ins[0];
    assert(class.raw != 0, "first input must be real");
    assert(class.lock == 0, "encumbered");
    if (class.kind == INCOME) & (class.term_until != 0) {
        assert(!class.term_until.lt(now), "income term expired");
    }
    if withdraw_raw != 0 {
        assert(class.kind == UNDERLYING, "only underlying leaves the pool");
        assert(class.asset == asset, "wrong asset");
    }

    let mut nullifiers = [0; 2];
    let mut commits = [0; 2];
    for i in 0..2 {
        assert_amount(ins[i].raw);
        assert_amount(outs[i].raw);
        if ins[i].raw != 0 {
            assert(ins[i].same_class(class), "mixed classes");
            assert_spendable(ins[i], sk, root, in_index[i], in_path[i]);
        }
        if outs[i].raw != 0 {
            assert(outs[i].same_class(class), "output changes class");
        }
        nullifiers[i] = ins[i].nullifier(sk);
        // An empty output is not a note: it gets no leaf, so it can never carry a lock
        // or take tree space.
        commits[i] = if outs[i].raw == 0 { 0 } else { outs[i].commit() };
    }
    assert_amount(withdraw_raw);
    assert(ins[0].raw + ins[1].raw == outs[0].raw + outs[1].raw + withdraw_raw, "unbalanced");
    (nullifiers, commits)
}
