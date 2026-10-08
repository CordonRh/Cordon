//! income.claim (spec §3.5): an INCOME note collects raw * (j_start - j_end) / j_bundle
//! underlying units for [t_start, t_end]. The contract supplies j_* from the
//! ActionEngine checkpoints, so PRINCIPAL + claimed INCOME never exceeds the bundle.
use cordon::{assert_floor_div, assert_spendable, DEPTH, INCOME, max, Note, UNDERLYING};

fn main(
    root: pub Field,
    asset: pub Field,
    t_start: pub Field,
    t_end: pub Field,
    j_start: pub Field,
    j_end: pub Field,
    sk: Field,
    note: Note,
    index: Field,
    path: [Field; DEPTH],
    payout_raw: Field, // floor(raw * (j_start - j_end) / j_bundle), computed by the prover
    blindings: [Field; 2],
) -> pub (Field, Field, Field) {
    assert(note.kind == INCOME, "not income");
    assert(note.asset == asset, "wrong asset");
    assert(note.lock == 0, "encumbered");
    assert_spendable(note, sk, root, index, path);

    assert(t_start == max(note.accrued_to, note.term_from), "wrong start");
    t_end.assert_max_bit_size::<64>();
    assert(!t_end.lt(t_start), "nothing to claim");
    if note.term_until != 0 {
        assert(!note.term_until.lt(t_end), "past term");
    }

    j_start.assert_max_bit_size::<128>();
    j_end.assert_max_bit_size::<128>();
    note.j_bundle.assert_max_bit_size::<128>();
    assert(note.j_bundle != 0, "no index");
    assert(!j_start.lt(j_end), "index went backwards");
    assert_floor_div(payout_raw, note.raw * (j_start - j_end), note.j_bundle);

    let mut next = note;
    next.accrued_to = t_end;
    next.blinding = blindings[0];
    let payout = Note {
        asset,
        raw: payout_raw,
        kind: UNDERLYING,
        bundle_id: 0,
        j_bundle: 0,
        term_from: 0,
        term_until: 0,
        accrued_to: 0,
        lock: 0,
        owner_pk: note.owner_pk,
        blinding: blindings[1],
    };
    (note.nullifier(sk), next.commit(), payout.commit())
}
