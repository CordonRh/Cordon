//! bundle (spec §3.2): 1 UnderlyingNote -> one claim note per allowed claim type,
//! all with the same asset, raw units and bundleId = H(underlying commit).
//! The 10 bps fee is deducted in raw units and credited to the pool's fee balance.
use cordon::{assert_amount, assert_spendable, DEPTH, h1, INCOME, Note, UNDERLYING};

fn main(
    root: pub Field,
    now: pub Field,
    asset: pub Field,
    j_now: pub Field,
    claim_mask: pub u8, // bit k set = claim kind k+1 allowed for this asset class
    fee_raw: pub Field,
    sk: Field,
    underlying: Note,
    index: Field,
    path: [Field; DEPTH],
    blindings: [Field; 5],
) -> pub (Field, [Field; 5]) {
    assert(underlying.kind == UNDERLYING, "not underlying");
    assert(underlying.lock == 0, "encumbered");
    assert(underlying.asset == asset, "wrong asset");
    assert_amount(underlying.raw);
    assert_spendable(underlying, sk, root, index, path);

    // fee_raw == floor(raw * 10 / 10000)
    assert_amount(fee_raw);
    let fee_scaled = fee_raw * 1000;
    assert(!underlying.raw.lt(fee_scaled), "fee too high");
    assert(underlying.raw.lt(fee_scaled + 1000), "fee too low");
    let raw = underlying.raw - fee_raw;
    assert(raw != 0, "nothing to bundle");

    let bundle_id = h1(underlying.commit());
    let mut commits = [0; 5];
    for k in 0..5 {
        if (claim_mask >> (k as u8)) & 1 == 1 {
            let kind = (k + 1) as Field;
            commits[k] = Note {
                asset,
                raw,
                kind,
                bundle_id,
                j_bundle: j_now,
                term_from: 0,
                term_until: 0,
                accrued_to: if kind == INCOME { now } else { 0 },
                lock: 0,
                owner_pk: underlying.owner_pk,
                blinding: blindings[k],
            }
                .commit();
        }
    }
    (underlying.nullifier(sk), commits)
}
