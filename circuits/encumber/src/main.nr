//! encumber (spec §3.3): the owner swaps a free note for the same note locked to an
//! EncumbranceNote. Locked notes cannot transfer, unbundle, trade or claim income.
use cordon::{assert_spendable, DEPTH, Encumbrance, LIEN, Note, TRANCHES};

fn main(
    root: pub Field,
    asset: pub Field, // the registry checks the asset allows this template
    kind: pub Field,
    until: pub Field,
    release_hash: pub Field,
    sk: Field,
    note: Note,
    index: Field,
    path: [Field; DEPTH],
    enc: Encumbrance,
    locked_blinding: Field,
) -> pub (Field, Field, Field) {
    assert(note.asset == asset, "wrong asset");
    assert(note.lock == 0, "already encumbered");
    assert(note.raw != 0, "empty note");
    assert_spendable(note, sk, root, index, path);
    assert(!LIEN.lt(kind), "unknown kind");
    until.assert_max_bit_size::<64>();
    assert((enc.kind == kind) & (enc.until == until) & (enc.release_hash == release_hash), "enc mismatch");
    assert(enc.claim == note.commit(), "enc bound to another note");
    for i in 0..TRANCHES {
        enc.tranche_cap[i].assert_max_bit_size::<120>();
    }

    let mut locked = note;
    locked.lock = enc.commit();
    locked.blinding = locked_blinding;
    (note.nullifier(sk), locked.commit(), locked.lock)
}
