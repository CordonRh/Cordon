//! release path (spec §3.3): once the registry marks the encumbrance released (holder
//! secret, or LOCKUP past `until`), the locked note becomes a free note of the owner.
use cordon::{assert_amount, derive, DEPTH, Encumbrance, locked_nullifier, merkle_root, Note, TRANCHES};

fn main(
    root: pub Field,
    enc_commit: pub Field,
    note: Note,
    index: Field,
    path: [Field; DEPTH],
    enc: Encumbrance,
) -> pub (Field, Field) {
    assert(enc.commit() == enc_commit, "wrong encumbrance");
    assert(note.lock == enc_commit, "note not under this encumbrance");
    assert_amount(note.raw);
    assert(note.raw != 0, "empty note");
    assert(merkle_root(note.commit(), index, path) == root, "unknown note");

    let mut free = note;
    free.lock = 0;
    // Owner and holder both know enc.blinding, so whoever unlocks, the owner can open the note.
    free.blinding = derive(enc.blinding, TRANCHES as Field + 1, 0);
    (locked_nullifier(note, enc), free.commit())
}
