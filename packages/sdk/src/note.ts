/** Note model (spec §2), mirroring circuits/lib/src/lib.nr field for field. */
import { h1, h2, h3 } from "./hash";

export const KIND = { UNDERLYING: 0n, PRINCIPAL: 1n, INCOME: 2n, VOTE: 3n, REDEEM: 4n, CONTROL: 5n } as const;
export const ENC_KIND = { LOCKUP: 0n, PLEDGE: 1n, LIEN: 2n } as const;
export const TRANCHES = 4;

export type Note = {
  asset: bigint;
  raw: bigint;
  kind: bigint;
  bundleId: bigint;
  jBundle: bigint;
  termFrom: bigint;
  termUntil: bigint;
  accruedTo: bigint;
  lock: bigint;
  ownerPk: bigint;
  blinding: bigint;
};

export type Encumbrance = {
  kind: bigint;
  until: bigint;
  obligation: bigint;
  tranchePk: bigint[]; // TRANCHES entries, waterfall order
  trancheCap: bigint[];
  releaseHash: bigint;
  claim: bigint;
  blinding: bigint;
};

/** Note owner key: h1(spending key). */
export const ownerPkOf = (sk: bigint) => h1(sk);

/**
 * Terms a holder may accept: a PLEDGE or LIEN whose first tranche is the holder and covers
 * the whole locked note. The pledgor's client chooses the terms, so the holder checks them:
 * a smaller cap would hand the rest back to the pledgor at enforcement, and a LOCKUP
 * releases itself.
 */
export function holderTermsOk(e: Encumbrance, holderPk: bigint, lockedRaw: bigint): boolean {
  const kindOk = e.kind === ENC_KIND.PLEDGE || e.kind === ENC_KIND.LIEN;
  return kindOk && e.tranchePk[0] === holderPk && (e.trancheCap[0] ?? 0n) >= lockedRaw;
}

/** A free UNDERLYING note (no claim class, no lock). */
export function underlying(asset: `0x${string}` | bigint, raw: bigint, ownerPk: bigint, blinding: bigint): Note {
  return {
    asset: BigInt(asset),
    raw,
    kind: KIND.UNDERLYING,
    bundleId: 0n,
    jBundle: 0n,
    termFrom: 0n,
    termUntil: 0n,
    accruedTo: 0n,
    lock: 0n,
    ownerPk,
    blinding,
  };
}

/** What a depositor or sender publishes instead of the owner key. */
export const npk = (n: Note) => h2(n.ownerPk, n.blinding);

/** Note commitment, as inserted into the pool tree. */
export function commit(n: Note): bigint {
  return h3(
    h3(npk(n), n.asset, n.raw),
    h3(n.kind, n.bundleId, n.jBundle),
    h2(h3(n.termFrom, n.termUntil, n.accruedTo), n.lock),
  );
}

/** Nullifier the owner publishes when spending a note. */
export const nullifier = (n: Note, sk: bigint) => h2(commit(n), sk);

/** Encumbrance commitment (the lock a locked note carries). */
export function encCommit(e: Encumbrance): bigint {
  let w = 0n;
  for (let i = 0; i < TRANCHES; i++) w = h3(w, e.tranchePk[i] ?? 0n, e.trancheCap[i] ?? 0n);
  return h3(h3(e.kind, e.tranchePk[0] ?? 0n, e.until), h3(e.obligation, w, e.releaseHash), h2(e.claim, e.blinding));
}

/** Circuit input shape (snake_case, decimal strings) for noir_js. */
export function noteInput(n: Note) {
  return {
    asset: n.asset.toString(),
    raw: n.raw.toString(),
    kind: n.kind.toString(),
    bundle_id: n.bundleId.toString(),
    j_bundle: n.jBundle.toString(),
    term_from: n.termFrom.toString(),
    term_until: n.termUntil.toString(),
    accrued_to: n.accruedTo.toString(),
    lock: n.lock.toString(),
    owner_pk: n.ownerPk.toString(),
    blinding: n.blinding.toString(),
  };
}

/** The encumbrance as circuit input (tranches padded to TRANCHES). */
export function encInput(e: Encumbrance) {
  const pad = (xs: bigint[]) => Array.from({ length: TRANCHES }, (_, i) => (xs[i] ?? 0n).toString());
  return {
    kind: e.kind.toString(),
    until: e.until.toString(),
    obligation: e.obligation.toString(),
    tranche_pk: pad(e.tranchePk),
    tranche_cap: pad(e.trancheCap),
    release_hash: e.releaseHash.toString(),
    claim: e.claim.toString(),
    blinding: e.blinding.toString(),
  };
}

/** An empty (zero-raw) note: a placeholder input or output that takes no leaf. */
export const emptyNote = (blinding: bigint): Note => ({ ...underlying(0n, 0n, 0n, blinding) });
