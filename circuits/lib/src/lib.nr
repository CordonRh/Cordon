//! Cordon note model (spec §2). Every hash is Poseidon2 over 1–3 inputs so the
//! on-chain tree (contracts/src/libraries/Poseidon.sol) computes identical values.
use poseidon::poseidon2::Poseidon2;

pub global DEPTH: u32 = 32;

// Note kinds: the underlying as deposited, then the five claim types.
pub global UNDERLYING: Field = 0;
pub global PRINCIPAL: Field = 1;
pub global INCOME: Field = 2;
pub global VOTE: Field = 3;
pub global REDEEM: Field = 4;
pub global CONTROL: Field = 5;

pub fn h1(a: Field) -> Field {
    Poseidon2::hash([a], 1)
}
pub fn h2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}
pub fn h3(a: Field, b: Field, c: Field) -> Field {
    Poseidon2::hash([a, b, c], 3)
}

pub struct Note {
    pub asset: Field,
    pub raw: Field, // raw token units, < 2^120
    pub kind: Field,
    pub bundle_id: Field, // H(underlying commit); 0 for UNDERLYING
    pub j_bundle: Field, // income index when bundled (1e36 / income multiplier)
    pub term_from: Field, // INCOME only: accrual starts here (0 = from bundling)
    pub term_until: Field, // INCOME only: accrual ends here (0 = open-ended)
    pub accrued_to: Field, // INCOME only: income claimed up to this timestamp
    pub lock: Field, // encumbrance commit, 0 = free
    pub owner_pk: Field, // h1(spending key)
    pub blinding: Field,
}

impl Note {
    /// Note public key: what a depositor or sender publishes instead of owner_pk.
    pub fn npk(self) -> Field {
        h2(self.owner_pk, self.blinding)
    }

    pub fn commit(self) -> Field {
        h3(
            h3(self.npk(), self.asset, self.raw),
            h3(self.kind, self.bundle_id, self.j_bundle),
            h2(h3(self.term_from, self.term_until, self.accrued_to), self.lock),
        )
    }

    pub fn nullifier(self, sk: Field) -> Field {
        h2(self.commit(), sk)
    }

    /// What a claim note is besides asset and kind: which bundle, its index, its term
    /// and how far its income was claimed. Notes of one class are worth the same per raw unit.
    pub fn class_hash(self) -> Field {
        h3(h3(self.bundle_id, self.j_bundle, self.term_from), self.term_until, self.accrued_to)
    }

    /// Everything except raw units, owner and blinding: notes of one class can be
    /// split and merged freely without changing what they represent.
    pub fn same_class(self, other: Note) -> bool {
        (self.asset == other.asset)
            & (self.kind == other.kind)
            & (self.bundle_id == other.bundle_id)
            & (self.j_bundle == other.j_bundle)
            & (self.term_from == other.term_from)
            & (self.term_until == other.term_until)
            & (self.accrued_to == other.accrued_to)
            & (self.lock == other.lock)
    }
}

pub fn merkle_root(leaf: Field, index: Field, path: [Field; DEPTH]) -> Field {
    let bits: [bool; DEPTH] = index.to_le_bits();
    let mut node = leaf;
    for i in 0..DEPTH {
        node = if bits[i] { h2(path[i], node) } else { h2(node, path[i]) };
    }
    node
}

/// Checks the spending key owns the note and the note is in the tree.
pub fn assert_spendable(note: Note, sk: Field, root: Field, index: Field, path: [Field; DEPTH]) {
    assert(note.owner_pk == h1(sk), "not owner");
    assert(merkle_root(note.commit(), index, path) == root, "unknown note");
}

pub fn assert_amount(x: Field) {
    x.assert_max_bit_size::<120>();
}

pub fn max(a: Field, b: Field) -> Field {
    if a.lt(b) { b } else { a }
}

/// q == floor(num / den), with num < 2^250 and den != 0 range-checked by the caller.
pub fn assert_floor_div(q: Field, num: Field, den: Field) {
    q.assert_max_bit_size::<128>();
    let lo = q * den;
    assert(!num.lt(lo), "quotient too large");
    assert(num.lt(lo + den), "quotient too small");
}

#[test]
fn test_hash_matches_solidity_vector() {
    // Same vector is asserted in contracts/test/Poseidon.t.sol.
    assert(h2(1, 2) == 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383);
}

#[test]
fn test_floor_div() {
    assert_floor_div(3, 10, 3);
}

#[test(should_fail)]
fn test_floor_div_rejects_wrong_quotient() {
    assert_floor_div(4, 10, 3);
}

// Encumbrance kinds (spec §3.3).
pub global LOCKUP: Field = 0;
pub global PLEDGE: Field = 1;
pub global LIEN: Field = 2;
pub global TRANCHES: u32 = 4;

/// EncumbranceNote. A locked claim note carries `lock = commit()`; the holder is the
/// first waterfall tranche. `release_hash = h1(secret)` lets the holder release it
/// by revealing the secret, without revealing who the holder is.
pub struct Encumbrance {
    pub kind: Field,
    pub until: Field,
    pub obligation: Field, // hash of the loan terms the default condition refers to
    pub tranche_pk: [Field; TRANCHES], // waterfall order; unused tranches have cap 0
    pub tranche_cap: [Field; TRANCHES],
    pub release_hash: Field,
    pub claim: Field, // commit of the free claim note that was encumbered
    pub blinding: Field,
}

impl Encumbrance {
    pub fn waterfall(self) -> Field {
        let mut w = 0;
        for i in 0..TRANCHES {
            w = h3(w, self.tranche_pk[i], self.tranche_cap[i]);
        }
        w
    }

    pub fn commit(self) -> Field {
        h3(
            h3(self.kind, self.tranche_pk[0], self.until),
            h3(self.obligation, self.waterfall(), self.release_hash),
            h2(self.claim, self.blinding),
        )
    }
}

/// Nullifier of a locked note: owner and holder both know the encumbrance blinding,
/// so either can spend it (subject to the registry's release / default state).
pub fn locked_nullifier(note: Note, enc: Encumbrance) -> Field {
    h2(note.commit(), enc.blinding)
}

// DvP orders (spec §3.4).
pub global GIVES: u32 = 8;

pub struct OrderGive {
    pub active: bool,
    pub note: Note,
    pub amount: Field, // raw units given from the note; the rest returns as change
    pub price_quote: Field, // agreed value per raw unit for claim notes; 0 = oracle-priced
}

/// What a trader authorises with its order proof: the notes and amounts it gives, the
/// asset it wants back, the key that receives it, and until when.
pub struct Order {
    pub gives: [OrderGive; GIVES], // active ones first
    pub want_asset: Field,
    pub want_kind: Field,
    pub want_quote: Field,
    pub want_class: Field, // claim kinds: the exact class wanted (Note::class_hash); 0 for underlying
    pub want_min: Field, // fewest raw units this order accepts in return
    pub receive_pk: Field,
    pub expiry: Field,
    pub salt: Field, // secret seed for this order's new notes (see derive)
}

impl Order {
    pub fn hash(self) -> Field {
        let mut h = h3(
            h3(self.want_asset, self.want_kind, self.want_quote),
            self.receive_pk,
            h3(self.expiry, self.salt, h2(self.want_min, self.want_class)),
        );
        for i in 0..GIVES {
            let g = self.gives[i];
            let (c, t) = if g.active {
                (g.note.commit(), h2(g.amount, g.price_quote))
            } else {
                (0, 0)
            };
            h = h3(h, c, t);
        }
        h
    }
}

/// Blinding or pad for a note an engine creates for someone else: both parties can
/// rebuild it from a shared secret seed, so no one depends on a third party to deliver it.
pub fn derive(seed: Field, slot: Field, tag: Field) -> Field {
    h3(seed, slot, tag)
}

pub global TAG_OUT: Field = 1;
pub global TAG_CHANGE: Field = 2;
pub global TAG_MEMO: Field = 3;
