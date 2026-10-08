//! unbundle (spec §3.2): the full set of free claim notes of one bundle -> 1
//! UnderlyingNote. Income must be claimed up to the latest index checkpoint, and
//! the underlying returned is what PRINCIPAL still backs: raw * j_now / j_bundle.
use cordon::{
    assert_amount, assert_floor_div, assert_spendable, DEPTH, INCOME, max, Note, UNDERLYING,
};

fn main(
    root: pub Field,
    now: pub Field,
    asset: pub Field,
    j_now: pub Field,
    t_last: pub Field, // timestamp of the latest income checkpoint
    claim_mask: pub u8,
    sk: Field,
    claims: [Note; 5],
    index: [Field; 5],
    path: [[Field; DEPTH]; 5],
    out_blinding: Field,
    out_raw: Field, // floor(raw * j_now / j_bundle), computed by the prover
) -> pub ([Field; 5], Field) {
    assert(claim_mask & 3 == 3, "PRINCIPAL and INCOME are always part of a bundle");
    let first = claims[0];
    assert_amount(first.raw);
    let mut nullifiers = [0; 5];
    for k in 0..5 {
        if (claim_mask >> (k as u8)) & 1 == 1 {
            let c = claims[k];
            assert(c.kind == (k + 1) as Field, "wrong claim kind");
            assert(c.asset == asset, "wrong asset");
            assert(c.raw == first.raw, "raw mismatch");
            assert(c.bundle_id == first.bundle_id, "bundle mismatch");
            assert(c.j_bundle == first.j_bundle, "index mismatch");
            assert(c.lock == 0, "encumbered claim");
            assert(c.term_until == 0, "income term still sold");
            if c.kind == INCOME {
                assert(!now.lt(c.term_from), "income remainder not started");
                let claimed_to = max(c.accrued_to, c.term_from);
                assert(!claimed_to.lt(t_last), "claim income first");
                // Income claimed past the proof time would be paid again through j_now.
                assert(!now.lt(claimed_to), "income claimed past proof time");
            } else {
                assert((c.term_from == 0) & (c.accrued_to == 0), "bad claim note");
            }
            assert_spendable(c, sk, root, index[k], path[k]);
            nullifiers[k] = c.nullifier(sk);
        }
    }

    first.j_bundle.assert_max_bit_size::<128>();
    j_now.assert_max_bit_size::<128>();
    assert(first.j_bundle != 0, "no index");
    assert_floor_div(out_raw, first.raw * j_now, first.j_bundle);
    let out = Note {
        asset,
        raw: out_raw,
        kind: UNDERLYING,
        bundle_id: 0,
        j_bundle: 0,
        term_from: 0,
        term_until: 0,
        accrued_to: 0,
        lock: 0,
        owner_pk: first.owner_pk,
        blinding: out_blinding,
    };
    (nullifiers, out.commit())
}
