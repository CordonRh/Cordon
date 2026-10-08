//! enforce (spec §3.3): after a declared default, the locked note is split down the
//! waterfall in tranche order (each tranche gets min(cap, what is left)) and re-keyed
//! to the tranche holders; any residual goes back to the owner, free.
use cordon::{assert_amount, derive, DEPTH, Encumbrance, locked_nullifier, merkle_root, Note, TRANCHES};

fn main(
    root: pub Field,
    enc_commit: pub Field,
    note: Note,
    index: Field,
    path: [Field; DEPTH],
    enc: Encumbrance,
) -> pub (Field, [Field; TRANCHES + 1]) {
    assert(enc.commit() == enc_commit, "wrong encumbrance");
    assert(note.lock == enc_commit, "note not under this encumbrance");
    assert_amount(note.raw);
    assert(note.raw != 0, "empty note");
    assert(merkle_root(note.commit(), index, path) == root, "unknown note");

    let mut commits = [0; TRANCHES + 1];
    let mut left = note.raw;
    for i in 0..TRANCHES {
        let cap = enc.tranche_cap[i];
        cap.assert_max_bit_size::<120>();
        let take = if cap.lt(left) { cap } else { left };
        if take != 0 {
            let mut out = note;
            out.raw = take;
            out.lock = 0;
            out.owner_pk = enc.tranche_pk[i];
            // Derived, not chosen: whoever enforces, every tranche holder can open its note.
            out.blinding = derive(enc.blinding, i as Field, 0);
            commits[i] = out.commit();
        }
        left -= take;
    }
    if left != 0 {
        let mut rest = note;
        rest.raw = left;
        rest.lock = 0;
        rest.blinding = derive(enc.blinding, TRANCHES as Field, 0);
        commits[TRANCHES] = rest.commit();
    }
    (locked_nullifier(note, enc), commits)
}
