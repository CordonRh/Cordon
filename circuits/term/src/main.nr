//! term (spec §3.2): INCOME(raw, open-ended) -> INCOME(raw, until T) +
//! INCOME_REMAINDER(raw, from T). The remainder becomes a full INCOME right at T.
use cordon::{assert_spendable, DEPTH, INCOME, Note};

fn main(
    root: pub Field,
    now: pub Field,
    sk: Field,
    income: Note,
    index: Field,
    path: [Field; DEPTH],
    until: Field,
    blindings: [Field; 2],
) -> pub (Field, [Field; 2]) {
    assert(income.kind == INCOME, "not income");
    assert(income.lock == 0, "encumbered");
    assert((income.term_from == 0) & (income.term_until == 0), "already termed");
    assert_spendable(income, sk, root, index, path);
    until.assert_max_bit_size::<64>();
    assert(now.lt(until), "term must end in the future");

    let mut termed = income;
    termed.term_until = until;
    termed.blinding = blindings[0];
    let mut remainder = income;
    remainder.term_from = until;
    remainder.blinding = blindings[1];
    (income.nullifier(sk), [termed.commit(), remainder.commit()])
}
