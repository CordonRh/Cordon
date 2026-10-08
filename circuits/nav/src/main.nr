//! NAV attestation (spec §3.6): the vault's notes (owned by the vault key) valued at
//! the batch-pinned oracle prices, minus declared liabilities, equal
//! nav_per_share x total_shares. Encumbered notes count as zero: whatever is pledged
//! is owed. Individual holdings stay private; only their commitment root is public.
use cordon::{assert_floor_div, assert_spendable, DEPTH, h1, h2, Note, UNDERLYING};

global HOLDINGS: u32 = 16;
global PRICES: u32 = 16;

pub struct Holding {
    active: bool,
    note: Note,
    index: Field,
    path: [Field; DEPTH],
    price_idx: u8,
}

fn main(
    root: pub Field,
    vault_pk: pub Field,
    epoch: pub Field,
    nav_per_share: pub Field, // 1e18 = 1 USD per whole share
    total_shares: pub Field, // raw share units (18 decimals)
    liabilities: pub Field, // USD, 1e27 = 1 USD
    price_asset: pub [Field; PRICES],
    price: pub [Field; PRICES], // per raw unit, 1e27 = 1 USD
    sk: Field,
    holdings: [Holding; HOLDINGS],
) -> pub (Field, [Field; HOLDINGS]) {
    let _ = epoch;
    assert(h1(sk) == vault_pk, "not the vault key");
    total_shares.assert_max_bit_size::<128>();
    assert(total_shares != 0, "no shares");
    liabilities.assert_max_bit_size::<224>();

    let mut value = 0;
    let mut holdings_root = 0;
    let mut nullifiers = [0; HOLDINGS];
    for i in 0..HOLDINGS {
        let h = holdings[i];
        if h.active {
            let n = h.note;
            assert(n.kind == UNDERLYING, "holdings are underlying notes");
            assert_spendable(n, sk, root, h.index, h.path);
            n.raw.assert_max_bit_size::<110>();
            let k = h.price_idx as u32;
            assert(k < PRICES, "bad price index");
            assert(price_asset[k] == n.asset, "holding not priced");
            price[k].assert_max_bit_size::<100>();
            if n.lock == 0 {
                value += n.raw * price[k];
            }
            holdings_root = h2(holdings_root, n.commit());
            nullifiers[i] = n.nullifier(sk);
        }
    }
    assert(!value.lt(liabilities), "liabilities exceed holdings");
    // nav_per_share = floor((value - liabilities) * 1e9 / total_shares)
    assert_floor_div(nav_per_share, (value - liabilities) * 1000000000, total_shares);
    (holdings_root, nullifiers)
}
