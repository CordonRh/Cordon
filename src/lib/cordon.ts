/**
 * Browser side of the protocol: spending key, notes, proofs and submission.
 * Off unless VITE_CORDON_DEPLOYMENT is set, so the dashboard stays device-local
 * until contracts are deployed. Notes live in the workspace (encrypted when synced).
 */
import {
  assetGateAbi,
  actionEngineAbi,
  bundleVerifierAbi,
  cordonPoolAbi,
  dvpSettlerAbi,
  encumbranceRegistryAbi,
  navAttestorAbi,
  priceOracleAbi,
} from "@cordon/shared";
import {
  bundleArgs,
  bundleInputs,
  claimArgs,
  claimNotes,
  commit,
  emptyNote,
  ENC_KIND,
  encCommit,
  holderTermsOk,
  encumberArgs,
  encumberInputs,
  fetchCircuits,
  FIELD,
  h1,
  h2,
  incomeInputs,
  initHasher,
  KIND,
  lockedSpendArgs,
  lockedSpendInputs,
  navArgs,
  navInputs,
  npk,
  nullifier,
  open,
  NoteTree,
  dvpNotesFor,
  lockedOutputBlinding,
  orderAuth,
  orderHash,
  orderInputs,
  ownerPkOf,
  Prover,
  randomField,
  seal,
  sealKeyFromSeed,
  termArgs,
  termInputs,
  toHex,
  transferArgs,
  transferInputs,
  unbundleArgs,
  unbundleInputs,
  underlying,
  type CircuitName,
  type Encumbrance,
  type Note,
  type OrderTerms,
} from "@cordon/sdk";
import { encodeFunctionData, erc20Abi, keccak256, toBytes, zeroAddress, type Address } from "viem";
import { getBlock, getPublicClient, readContract, sendTransaction, waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { env } from "./env";
import { trpc } from "./trpc";
import { robinhood, signWithWallet, wagmiConfig } from "./wallet";

type Deployment = {
  pool: Address;
  bundleVerifier: Address;
  actionEngine: Address;
  assetGate: Address;
  encumbranceRegistry: Address;
  navAttestor: Address;
  priceOracle: Address;
  dvpSettler: Address;
  deployBlock?: number;
};

export const deployment: Deployment | null = (() => {
  try {
    return env.deployment ? (JSON.parse(env.deployment) as Deployment) : null;
  } catch {
    return null;
  }
})();
export const protocolEnabled = Boolean(deployment && env.supabaseUrl);

export const NOTE_KEY_MESSAGE = [
  "Cordon note key v1",
  "",
  "Signing derives the key that owns your private notes on Robinhood Chain.",
  "It does not approve a transaction or move assets. Never sign this on another site.",
].join("\n");

/** A note as kept in the workspace: decimal strings, plus where it stands (and, when locked, its encumbrance as JSON). */
export type StoredNote = Record<keyof Note, string> & { commit: string; status: "pending" | "live" | "spent"; enc?: string };
/** What an action did to the workspace: notes it spent and notes it created. */
export type Change = { tx: string | null; spent: string[]; add: StoredNote[]; message?: string };

const toStored = (n: Note, status: StoredNote["status"]): StoredNote => ({
  ...(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, (v as bigint).toString()])) as Record<keyof Note, string>),
  commit: commit(n).toString(),
  status,
});
/** A stored (decimal-string) note as a Note. */
export const fromStored = (s: StoredNote): Note =>
  Object.fromEntries(Object.keys(underlying(0n, 0n, 0n, 0n)).map((k) => [k, BigInt(s[k as keyof Note])])) as Note;

let sk: bigint | undefined;
let prover: Prover | undefined;

/** The note spending key, derived once per session from a wallet signature. */
export async function spendingKey() {
  await initHasher();
  if (sk === undefined) {
    const sig = await signWithWallet(NOTE_KEY_MESSAGE);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sig)));
    sk = digest.reduce((x, b) => (x << 8n) | BigInt(b), 0n) % FIELD;
  }
  return sk;
}

/** True once the note key was derived this session (so background work never prompts a signature). */
export const keyReady = () => sk !== undefined;

/** Drops the session's note keys (on disconnect or wallet change). */
export const forgetKey = () => {
  sk = undefined;
  recv = undefined;
};

async function tree() {
  const leaves: bigint[] = [];
  for (let from = 0; ; from += 5000) {
    const page = await trpc.tree.leaves.query({ from, limit: 5000 });
    leaves.push(...page.map((r) => BigInt(r.commit)));
    if (page.length < 5000) return new NoteTree(leaves);
  }
}

/** The tree once the indexer has caught up with `n` (notes from a relayed action show up a few blocks later). */
async function treeWith(n: Note) {
  for (let i = 0; ; i++) {
    const t = await tree();
    if (t.indexOf(commit(n)) >= 0) return t;
    if (i === 24) throw new Error("This note is not indexed yet. Try again in a minute.");
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** Chain time with a margin: engines reject proofs dated after the block that checks them. */
async function chainNow() {
  const b = await getBlock(wagmiConfig, { chainId: robinhood.id });
  return b.timestamp - 30n;
}

async function prove(name: CircuitName, inputs: object) {
  prover ??= new Prover(fetchCircuits("/circuits"));
  return prover.prove(name, inputs as never);
}

function need() {
  if (!deployment) throw new Error("Cordon is not deployed on this network yet.");
  return deployment;
}

const addressOf = (field: bigint) => `0x${field.toString(16).padStart(40, "0")}` as Address;
const day = (ts: bigint) => new Date(Number(ts) * 1000).toLocaleDateString();

export type Hooks = {
  step?: (s: "Proving" | "Submitted") => void;
  /** Merge a change into the workspace (called with pending notes before relaying, so none are ever lost). */
  keep?: (c: Change) => void;
  /** Forget pending notes whose action definitely failed. */
  drop?: (commits: string[]) => void;
};

/**
 * Relays an action; its new notes are kept as pending first. A slow relayer leaves them
 * pending (they go live once indexed); only a definite failure drops them.
 * Note: inputs of a timed-out action stay marked live until reused (the relayer then
 * rejects the spent nullifier); reconcile via tree.spent if that confuses users.
 */
async function relay(target: Address, data: `0x${string}`, change: Omit<Change, "tx">, h: Hooks): Promise<Change> {
  const pending = change.add.map((s) => ({ ...s, status: "pending" as const }));
  const forget = () => h.drop?.(pending.map((s) => s.commit));
  h.keep?.({ tx: null, spent: [], add: pending });
  h.step?.("Submitted");
  let job: number;
  try {
    ({ job } = await trpc.relay.submit.mutate({ target, data }));
  } catch (e) {
    // The relayer is a convenience: when it refuses (rate limit, outage), the wallet
    // submits the same proof-carrying call itself, so exits never depend on it.
    try {
      const hash = await sendTransaction(wagmiConfig, { to: target, data });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      return { tx: hash, ...change };
    } catch (own) {
      forget();
      throw own instanceof Error && own.message ? own : e;
    }
  }
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await trpc.relay.status.query(job);
    if (s?.status === "confirmed") return { tx: s.tx_hash, ...change };
    if (s?.status === "failed") {
      forget();
      throw new Error("The relayer could not settle this request.");
    }
  }
  throw new Error("Still waiting for the relayer. The new notes stay pending until they are indexed.");
}

/** Commits of pending notes that have reached the tree (deposits past standby, relayed notes once indexed). */
export async function indexed(notes: StoredNote[]) {
  const pending = notes.filter((s) => s.status === "pending");
  if (!pending.length) return [];
  const t = await tree();
  return pending.filter((s) => t.indexOf(BigInt(s.commit)) >= 0).map((s) => s.commit);
}

/** Deposits `raw` units of `asset` for a fresh note; it goes live after the standby. */
export async function deposit(asset: Address, raw: bigint): Promise<StoredNote> {
  const d = need();
  const note = underlying(asset, raw, ownerPkOf(await spendingKey()), randomField());
  const approve = await writeContract(wagmiConfig, {
    address: asset,
    abi: erc20Abi,
    functionName: "approve",
    args: [d.pool, raw],
    chainId: robinhood.id,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: approve });
  const hash = await writeContract(wagmiConfig, {
    address: d.pool,
    abi: cordonPoolAbi,
    functionName: "deposit",
    args: [asset, raw, npk(note)],
    chainId: robinhood.id,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return toStored(note, "pending");
}

/** Bundles a live underlying note through the relayer into its claim notes. */
export async function bundle(stored: StoredNote, h: Hooks): Promise<Change> {
  const d = need();
  const key = await spendingKey();
  const u = fromStored(stored);
  const asset = addressOf(u.asset);
  const [latest, mask, t, now] = await Promise.all([
    readContract(wagmiConfig, { address: d.actionEngine, abi: actionEngineAbi, functionName: "latest", args: [asset] }),
    readContract(wagmiConfig, { address: d.assetGate, abi: assetGateAbi, functionName: "claimMask", args: [asset] }),
    tree(),
    chainNow(),
  ]);
  if (t.indexOf(commit(u)) < 0) throw new Error("This deposit is still in its 15-minute standby.");

  h.step?.("Proving");
  const blindings = Array.from({ length: 5 }, randomField);
  const { feeRaw, inputs } = bundleInputs({ tree: t, now, jNow: latest[1], claimMask: mask, sk: key, underlying: u, blindings });
  const p = await prove("bundle", inputs);

  const data = encodeFunctionData({
    abi: bundleVerifierAbi,
    functionName: "bundle",
    args: [toHex(p.proof), bundleArgs(p.publicInputs, asset, feeRaw)],
  });
  const claims = claimNotes(u, feeRaw, latest[1], now, blindings).filter((_, k) => (mask >> k) & 1);
  return relay(d.bundleVerifier, data, { spent: [stored.commit], add: claims.map((c) => toStored(c, "live")) }, h);
}

/**
 * Withdraws `raw` units of a free underlying note to `recipient` (bound in the proof, so the
 * relayer cannot redirect it). The rest stays private as a change note to the same owner.
 * A whole note leaves with the exact amount it was deposited with, which can link the two, so
 * it is opt-in: pass `"whole"`; an amount equal to the whole note is refused.
 */
export async function withdraw(stored: StoredNote, recipient: Address, h: Hooks, raw: bigint | "whole"): Promise<Change> {
  const d = need();
  const n = fromStored(stored);
  if (n.kind !== KIND.UNDERLYING || n.lock !== 0n) throw new Error("Only a free underlying note can be withdrawn.");
  const amount = raw === "whole" ? n.raw : raw;
  if (amount <= 0n || amount > n.raw) throw new Error(`Enter an amount from 1 to ${n.raw} raw units.`);
  if (raw !== "whole" && amount === n.raw)
    throw new Error("Withdrawing the whole note can link it to its deposit; confirm a whole-note withdrawal to continue.");
  const [key, t, now] = await Promise.all([spendingKey(), treeWith(n), chainNow()]);
  const pad = () => emptyNote(randomField());
  // The circuit balances ins = outs + withdrawRaw; the change keeps the note's class and owner.
  const change = { ...n, raw: n.raw - amount, blinding: randomField() };
  h.step?.("Proving");
  const p = await prove(
    "transfer",
    transferInputs({ tree: t, now, sk: key, ins: [n, pad()], outs: [change.raw ? change : pad(), pad()], withdrawRaw: amount, recipient }),
  );
  const data = encodeFunctionData({
    abi: cordonPoolAbi,
    functionName: "transact",
    args: [toHex(p.proof), transferArgs(p.publicInputs, addressOf(n.asset), amount, recipient)],
  });
  return relay(d.pool, data, { spent: [stored.commit], add: change.raw ? [toStored(change, "live")] : [] }, h);
}

/**
 * Claims what an INCOME note has accrued up to `tEnd` (default: now, capped at its term).
 * Without `force`, refuses when nothing has accrued; recombining forces it to catch the note up.
 */
export async function claimIncome(stored: StoredNote, h: Hooks, opts: { tEnd?: bigint; force?: boolean } = {}): Promise<Change> {
  const d = need();
  const n = fromStored(stored);
  if (n.kind !== KIND.INCOME || n.lock !== 0n) throw new Error("Only a free INCOME note can claim income.");
  const asset = addressOf(n.asset);
  const [key, t, now] = await Promise.all([spendingKey(), treeWith(n), chainNow()]);
  const tStart = n.accruedTo > n.termFrom ? n.accruedTo : n.termFrom;
  let tEnd = opts.tEnd ?? now;
  if (n.termUntil !== 0n && tEnd > n.termUntil) tEnd = n.termUntil;
  if (tEnd < tStart) throw new Error(`This income right starts on ${day(tStart)}.`);
  const indexAt = (ts: bigint) =>
    readContract(wagmiConfig, { address: d.actionEngine, abi: actionEngineAbi, functionName: "indexAt", args: [asset, ts] });
  const [jStart, jEnd] = await Promise.all([indexAt(tStart), indexAt(tEnd)]);
  if (jStart === jEnd && !opts.force) throw new Error("No income has accrued since the last claim.");

  h.step?.("Proving");
  const blindings: [bigint, bigint] = [randomField(), randomField()];
  const { payoutRaw, inputs } = incomeInputs({ tree: t, sk: key, note: n, tEnd, jStart, jEnd, blindings });
  const p = await prove("income", inputs);
  const data = encodeFunctionData({
    abi: bundleVerifierAbi,
    functionName: "claimIncome",
    args: [toHex(p.proof), claimArgs(p.publicInputs, asset)],
  });
  const next = toStored({ ...n, accruedTo: tEnd, blinding: blindings[0] }, "live");
  const payout = underlying(n.asset, payoutRaw, n.ownerPk, blindings[1]);
  return relay(d.bundleVerifier, data, { spent: [stored.commit], add: payoutRaw ? [next, toStored(payout, "live")] : [next] }, h);
}

/** Splits an open-ended INCOME note into income until `until` and the remainder from `until`. */
export async function setIncomeTerm(stored: StoredNote, until: bigint, h: Hooks): Promise<Change> {
  const d = need();
  const n = fromStored(stored);
  const [key, t, now] = await Promise.all([spendingKey(), treeWith(n), chainNow()]);
  if (until <= now) throw new Error("Choose a term that ends in the future.");
  h.step?.("Proving");
  const blindings: [bigint, bigint] = [randomField(), randomField()];
  const p = await prove("term", termInputs({ tree: t, now, sk: key, income: n, until, blindings }));
  const data = encodeFunctionData({ abi: bundleVerifierAbi, functionName: "term", args: [toHex(p.proof), termArgs(p.publicInputs)] });
  const add = [
    toStored({ ...n, termUntil: until, blinding: blindings[0] }, "live"),
    toStored({ ...n, termFrom: until, blinding: blindings[1] }, "live"),
  ];
  return relay(d.bundleVerifier, data, { spent: [stored.commit], add }, h);
}

/**
 * Recombines the free claim notes of one bundle into an underlying note. Income is
 * claimed up to the latest index checkpoint first, as the unbundle circuit requires.
 */
export async function unbundle(notes: StoredNote[], bundleId: string, h: Hooks): Promise<Change> {
  const d = need();
  const mine = notes
    .filter((s) => s.status === "live" && s.bundleId === bundleId && s.lock === "0" && s.termUntil === "0")
    .map((s) => ({ s, n: fromStored(s) }));
  if (!mine.length) throw new Error("No free claims of this bundle are in your workspace.");
  const asset = addressOf(mine[0].n.asset);
  const [mask, [tLast], now] = await Promise.all([
    readContract(wagmiConfig, { address: d.assetGate, abi: assetGateAbi, functionName: "claimMask", args: [asset] }),
    readContract(wagmiConfig, { address: d.actionEngine, abi: actionEngineAbi, functionName: "latest", args: [asset] }),
    chainNow(),
  ]);
  const names = ["PRINCIPAL", "INCOME", "VOTE", "REDEEM", "CONTROL"];
  const slots = names.map((name, k) => {
    const hit = mine.find((x) => x.n.kind === BigInt(k + 1));
    if (!hit && (mask >> k) & 1) throw new Error(`This bundle's ${name} claim is not free in your workspace.`);
    return hit;
  });
  h.step?.("Proving");
  let income = slots[1]!;
  if (income.n.termFrom > now) throw new Error(`The income remainder starts on ${day(income.n.termFrom)}.`);
  const claimedTo = income.n.accruedTo > income.n.termFrom ? income.n.accruedTo : income.n.termFrom;
  if (claimedTo < tLast) {
    const c = await claimIncome(income.s, h, { tEnd: tLast > now ? tLast : now, force: true });
    h.keep?.(c);
    h.step?.("Proving");
    income = { s: c.add[0], n: fromStored(c.add[0]) };
  }

  const [key, t, [, jNow]] = await Promise.all([
    spendingKey(),
    treeWith(income.n),
    readContract(wagmiConfig, { address: d.actionEngine, abi: actionEngineAbi, functionName: "latest", args: [asset] }),
  ]);
  const claims = slots.map((x, k) => (k === 1 ? income.n : (x ?? slots[0]!).n));
  const outBlinding = randomField();
  const { outRaw, inputs } = unbundleInputs({ tree: t, now: await chainNow(), jNow, tLast, claimMask: mask, sk: key, claims, outBlinding });
  const p = await prove("unbundle", inputs);

  const data = encodeFunctionData({
    abi: bundleVerifierAbi,
    functionName: "unbundle",
    args: [toHex(p.proof), unbundleArgs(p.publicInputs, asset)],
  });
  const used = slots.flatMap((x, k) => ((mask >> k) & 1 ? [k === 1 ? income.s.commit : x!.s.commit] : []));
  const out = underlying(asset, outRaw, claims[0].ownerPk, outBlinding);
  return relay(d.bundleVerifier, data, { spent: used, add: [toStored(out, "live")] }, h);
}

const encToJson = (e: Encumbrance) => JSON.stringify(e, (_, v) => (typeof v === "bigint" ? v.toString() : v));
const encFromJson = (s: string): Encumbrance => {
  const o = JSON.parse(s);
  return {
    kind: BigInt(o.kind),
    until: BigInt(o.until),
    obligation: BigInt(o.obligation),
    tranchePk: o.tranchePk.map(BigInt),
    trancheCap: o.trancheCap.map(BigInt),
    releaseHash: BigInt(o.releaseHash),
    claim: BigInt(o.claim),
    blinding: BigInt(o.blinding),
  };
};

export type EncKind = keyof typeof ENC_KIND;

/**
 * Locks a free note. LOCKUP: only time releases it. PLEDGE/LIEN: the holder may take the
 * whole note after a declared default. `holder` is the holder's pledge code: it carries
 * only the hash of a release secret the holder alone can compute, so the owner can never
 * release its own pledge.
 */
export async function encumber(
  stored: StoredNote,
  o: { kind: EncKind; until: bigint; holder?: string; obligation?: string },
  h: Hooks,
): Promise<Change> {
  const d = need();
  const n = fromStored(stored);
  const holder = o.kind === "LOCKUP" ? undefined : parsePledgeCode(o.holder ?? "");
  const [key, t, now] = await Promise.all([spendingKey(), treeWith(n), chainNow()]);
  if (o.until <= now) throw new Error("Choose an end date in the future.");
  const enc: Encumbrance = {
    kind: ENC_KIND[o.kind],
    until: o.until,
    obligation: holder ? await textField(o.obligation ?? "") : 0n,
    tranchePk: holder ? [holder.pk] : [],
    trancheCap: holder ? [n.raw] : [],
    releaseHash: holder ? holder.releaseHash : 0n,
    claim: commit(n),
    blinding: randomField(),
  };
  const lockedBlinding = randomField();
  h.step?.("Proving");
  const p = await prove("encumber", encumberInputs({ tree: t, sk: key, note: n, enc, lockedBlinding }));
  const data = encodeFunctionData({
    abi: encumbranceRegistryAbi,
    functionName: "encumber",
    args: [toHex(p.proof), encumberArgs(p.publicInputs, addressOf(n.asset), enc)],
  });
  const locked = { ...toStored({ ...n, lock: encCommit(enc), blinding: lockedBlinding }, "live"), enc: encToJson(enc) };
  // The holder gets the terms first, so a slow relayer never strands them.
  if (holder) await post(holder.pub, { t: "held", enc: locked.enc, locked, nonce: holder.nonce.toString() });
  return relay(d.encumbranceRegistry, data, { spent: [stored.commit], add: [locked] }, h);
}

async function encState(enc: Encumbrance) {
  const [exists, , , , released, defaulted, enforced] = await readContract(wagmiConfig, {
    address: need().encumbranceRegistry,
    abi: encumbranceRegistryAbi,
    functionName: "encumbrances",
    args: [encCommit(enc)],
  });
  return { exists, released, defaulted, enforced };
}

/** Frees a locked note once released (a LOCKUP past its end, or the holder's release). */
export async function unlock(stored: StoredNote, h: Hooks): Promise<Change> {
  const d = need();
  if (!stored.enc) throw new Error("This note's encumbrance is not in your workspace.");
  const n = fromStored(stored);
  const enc = encFromJson(stored.enc);
  const [released, state] = await Promise.all([
    readContract(wagmiConfig, { address: d.encumbranceRegistry, abi: encumbranceRegistryAbi, functionName: "isReleased", args: [encCommit(enc)] }),
    encState(enc),
  ]);
  if (state.enforced) return { tx: null, spent: [stored.commit], add: [], message: "The holder enforced this encumbrance after a default." };
  if (!released) throw new Error(enc.kind === ENC_KIND.LOCKUP ? `Locked until ${day(enc.until)}.` : "The holder has not released it yet.");
  const t = await treeWith(n);
  h.step?.("Proving");
  const p = await prove("unlock", lockedSpendInputs({ tree: t, locked: n, enc }));
  const data = encodeFunctionData({
    abi: encumbranceRegistryAbi,
    functionName: "unlock",
    args: [toHex(p.proof), lockedSpendArgs(p.publicInputs)],
  });
  const free = toStored({ ...n, lock: 0n, blinding: lockedOutputBlinding(enc, 5) }, "live");
  return relay(d.encumbranceRegistry, data, { spent: [stored.commit], add: [free] }, h);
}

/** An encumbrance where this wallet is the holder (from the inbox). `nonce` is from the pledge code. */
export type Held = { enc: string; locked: StoredNote; nonce: string; state?: "pending" | "invalid" | "active" | "released" | "defaulted" | "enforced" };

/** The on-chain commitment of a held encumbrance. */
export const heldCommit = (held: Held) => encCommit(encFromJson(held.enc)).toString();

/** "pending" until the encumbrance exists on-chain: a held item proves nothing by itself. */
export async function heldState(held: Held): Promise<NonNullable<Held["state"]>> {
  const enc = encFromJson(held.enc);
  const s = await encState(enc);
  if (!s.exists) return "pending";
  // The owner sent the locked note: it must be the leaf actually locked to this encumbrance,
  // or enforce could never be proven.
  const locked = fromStored(held.locked);
  if (!holderTermsOk(enc, ownerPkOf(await spendingKey()), locked.raw)) return "invalid";
  if (locked.lock !== encCommit(enc) || (await tree()).indexOf(commit(locked)) < 0) return "invalid";
  return s.enforced ? "enforced" : s.released ? "released" : s.defaulted ? "defaulted" : "active";
}

/** Holder: the obligation is met; reveal the secret so the owner can unlock. */
export async function release(held: Held, h: Hooks) {
  const enc = encFromJson(held.enc);
  const data = encodeFunctionData({
    abi: encumbranceRegistryAbi,
    functionName: "release",
    args: [encCommit(enc), await releaseSecret(BigInt(held.nonce))],
  });
  return relay(need().encumbranceRegistry, data, { spent: [], add: [] }, h);
}

/** Holder: ask for a default (the keeper declares it once approved; testnet approves at once). */
export async function requestDefault(held: Held) {
  await trpc.encumbrances.requestDefault.mutate(hex32(encCommit(encFromJson(held.enc))));
}

/** Holder: after a declared default, take the note down the waterfall (the whole note here). */
export async function enforce(held: Held, h: Hooks): Promise<Change> {
  const d = need();
  const enc = encFromJson(held.enc);
  const locked = fromStored(held.locked);
  if (!(await encState(enc)).defaulted) throw new Error("No default has been declared yet.");
  const t = await treeWith(locked);
  h.step?.("Proving");
  const p = await prove("enforce", lockedSpendInputs({ tree: t, locked, enc }));
  const data = encodeFunctionData({
    abi: encumbranceRegistryAbi,
    functionName: "enforce",
    args: [toHex(p.proof), lockedSpendArgs(p.publicInputs)],
  });
  const cap = enc.trancheCap[0] ?? 0n;
  const take = cap < locked.raw ? cap : locked.raw;
  const mine = toStored({ ...locked, raw: take, lock: 0n, ownerPk: enc.tranchePk[0], blinding: lockedOutputBlinding(enc, 0) }, "live");
  return relay(d.encumbranceRegistry, data, { spent: [], add: take ? [mine] : [] }, h);
}

// ---------------------------------------------------------------- keys and inbox

let recv: Awaited<ReturnType<typeof sealKeyFromSeed>> | undefined;

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const textField = async (s: string) => (await sha256(s)).reduce((x, b) => (x << 8n) | BigInt(b), 0n) % FIELD;
const hex32 = (x: bigint) => `0x${x.toString(16).padStart(64, "0")}`;
const b64ToHex = (b: string) => Array.from(atob(b), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const hexToB64 = (h: string) => btoa(String.fromCharCode(...(h.match(/../g) ?? []).map((x) => parseInt(x, 16))));

/** X25519 key others seal notes and disclosures to, derived from the note key. */
async function receivingKey() {
  recv ??= await sealKeyFromSeed(await sha256(`cordon receive v1:${await spendingKey()}`));
  return recv;
}

/** Share this so others can send you notes, name you as a holder, or disclose to you. */
export async function cordonKey() {
  const pk = ownerPkOf(await spendingKey());
  return `${hex32(pk)}${b64ToHex((await receivingKey()).publicKey)}`;
}

/** Parses a Cordon receiving key (owner key + X25519 key); throws if malformed. */
export function parseCordonKey(s: string) {
  const m = s.trim().toLowerCase().match(/^0x([0-9a-f]{64})([0-9a-f]{64})$/);
  if (!m) throw new Error("Enter a Cordon key: 0x followed by 128 hex characters (Settings → Your Cordon key).");
  return { pk: BigInt(`0x${m[1]}`), pub: hexToB64(m[2]) };
}

/** The release secret for a pledge code's nonce: only this wallet's spending key computes it. */
async function releaseSecret(nonce: bigint) {
  return h2(await spendingKey(), nonce);
}

/**
 * A pledge code for one pledge or lien this wallet will hold: Cordon key + the hash of a
 * fresh release secret + its nonce. The owner encumbers with it; only this wallet can
 * ever compute the secret, so only it can release. Nothing needs to be stored.
 */
export async function pledgeCode() {
  const nonce = randomField();
  return `${await cordonKey()}${hex32(h1(await releaseSecret(nonce))).slice(2)}${hex32(nonce).slice(2)}`;
}

/** Parses a holder's pledge code (owner key, X25519 key, release hash, nonce); throws if malformed. */
export function parsePledgeCode(s: string) {
  const m = s.trim().toLowerCase().match(/^0x([0-9a-f]{64})([0-9a-f]{64})([0-9a-f]{64})([0-9a-f]{64})$/);
  if (!m) throw new Error("Enter the holder's pledge code (Settings → New pledge code): 0x followed by 256 hex characters.");
  return { pk: BigInt(`0x${m[1]}`), pub: hexToB64(m[2]), releaseHash: BigInt(`0x${m[3]}`), nonce: BigInt(`0x${m[4]}`) };
}

export type InboxItem =
  | { t: "notes"; add: StoredNote[] }
  | { t: "held"; enc: string; locked: StoredNote; nonce: string }
  | { t: "dvp"; ref?: string; tx?: string; failed?: boolean; spent?: string[]; add?: StoredNote[] };

async function post(pub: string, item: InboxItem) {
  await trpc.inbox.post.mutate({ box: await seal(pub, item) });
}

/**
 * Opens every new inbox box meant for this wallet (others fail to decrypt). Notes are kept
 * only if they belong to this wallet's key; the caller checks DvP results against its orders.
 */
export async function readInbox(after: number) {
  const { privateKey } = await receivingKey();
  const mine = ownerPkOf(await spendingKey()).toString();
  const items: InboxItem[] = [];
  let cursor = after;
  for (;;) {
    const page = await trpc.inbox.since.query({ after: cursor });
    for (const r of page) {
      cursor = r.id;
      const item = await open<InboxItem>(privateKey, r.box).catch(() => null);
      if (!item) continue;
      if (item.t === "notes") item.add = item.add.filter((n) => n.ownerPk === mine && commit(fromStored(n)).toString() === n.commit);
      if (item.t === "held") {
        // Keep it only if the terms give this wallet the whole note and the release hash is one
        // only it can open.
        const e = encFromJson(item.enc);
        if (!item.nonce || !holderTermsOk(e, BigInt(mine), fromStored(item.locked).raw)) continue;
        if (h1(await releaseSecret(BigInt(item.nonce))) !== e.releaseHash) continue;
      }
      items.push(item);
    }
    if (page.length < 1000) return { cursor, items };
  }
}

/** Sends `raw` units of a note to another wallet's Cordon key; the rest stays as change. */
export async function send(stored: StoredNote, raw: bigint, to: string, h: Hooks): Promise<Change> {
  const d = need();
  const r = parseCordonKey(to);
  const n = fromStored(stored);
  if (n.lock !== 0n) throw new Error("A locked note cannot be sent.");
  if (raw <= 0n || raw > n.raw) throw new Error(`Enter an amount from 1 to ${n.raw} raw units.`);
  const [key, t, now] = await Promise.all([spendingKey(), treeWith(n), chainNow()]);
  const out = { ...n, raw, ownerPk: r.pk, blinding: randomField() };
  const change = { ...n, raw: n.raw - raw, blinding: randomField() };
  h.step?.("Proving");
  const p = await prove("transfer", transferInputs({ tree: t, now, sk: key, ins: [n, emptyNote(randomField())], outs: [out, change] }));
  const data = encodeFunctionData({
    abi: cordonPoolAbi,
    functionName: "transact",
    // Nothing is withdrawn, so the transfer names no asset: calldata does not say what moved.
    args: [toHex(p.proof), transferArgs(p.publicInputs, zeroAddress, 0n, zeroAddress)],
  });
  await post(r.pub, { t: "notes", add: [toStored(out, "pending")] });
  return relay(d.pool, data, { spent: [stored.commit], add: change.raw ? [toStored(change, "live")] : [] }, h);
}

// ---------------------------------------------------------------- DvP

/**
 * Places a sealed order: give `raw` units of `give` (from free underlying notes), receive
 * `want` at the batch's oracle prices. The order proof is made here with the spending key,
 * which never leaves the browser: the sequencer can settle the order as placed or not at
 * all, and spending one of its notes elsewhere cancels it. The result arrives in the inbox
 * tagged with `ref`.
 */
export async function placeOrder(
  p: { notes: StoredNote[]; give: Address; raw: bigint; want: Address; ref: string },
  h: Hooks = {},
): Promise<string> {
  const sk = await spendingKey();
  const asset = BigInt(p.give).toString();
  const gives: { note: Note; amount: bigint }[] = [];
  let left = p.raw;
  for (const s of p.notes.filter((n) => n.status === "live" && n.asset === asset && n.kind === "0" && n.lock === "0")) {
    if (left === 0n) break;
    const note = fromStored(s);
    const amount = note.raw < left ? note.raw : left;
    gives.push({ note, amount });
    left -= amount;
  }
  if (left > 0n) throw new Error("Not enough free notes of that asset in this workspace.");
  if (gives.length > 8) throw new Error("Too many notes for one order; recombine or withdraw some first.");
  // The fewest units accepted: today's quote less 1% (covers the batch tolerance and a move).
  const q = await trpc.dvp.quote.query({ assets: [p.give, p.want] });
  const priceOf = (a: Address) => BigInt(q.prices.find((x) => x.asset.toLowerCase() === a.toLowerCase())?.price ?? "0");
  const [pg, pw] = [priceOf(p.give), priceOf(p.want)];
  if (!pg || !pw) throw new Error("No current price for one of the assets; try again shortly.");
  const expected = (p.raw * pg) / pw;
  const terms: OrderTerms = {
    gives,
    wants: { asset: BigInt(p.want), kind: 0n },
    wantMin: (expected * 99n) / 100n,
    receivePk: ownerPkOf(sk),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    salt: randomField(),
  };
  h.step?.("Proving");
  const proof = await prove("order", orderInputs(sk, terms));
  const auth = orderAuth(toHex(proof.proof), proof.publicInputs);
  const [{ publicKey }, reply] = [await trpc.dvp.key.query(), (await receivingKey()).publicKey];
  const placedBlock = Number(await getPublicClient(wagmiConfig)!.getBlockNumber());
  await trpc.dvp.submit.mutate({ encryptedLegs: await seal(publicKey, { ...terms, auth, reply, ref: p.ref }) });
  return orderToJson({ ...terms, placedBlock } as OrderTerms);
}

const orderToJson = (o: OrderTerms) => JSON.stringify(o, (_, v) => (typeof v === "bigint" ? `${v}n` : v));
const orderFromJson = (s: string) =>
  JSON.parse(s, (_, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as OrderTerms;

/**
 * Rebuilds an order's result from the chain alone (DvPSettler.TradeSettled), without the
 * sequencer: its change and what it received. null while unsettled; `expired` once it can
 * no longer settle.
 */
export async function recoverOrder(json: string): Promise<(Change & { expired?: boolean }) | null> {
  const d = need();
  const o = orderFromJson(json);
  const h = orderHash(o);
  const client = getPublicClient(wagmiConfig)!;
  const placed = (o as OrderTerms & { placedBlock?: number }).placedBlock;
  const head = await client.getBlockNumber();
  const event = dvpSettlerAbi.find((x) => x.type === "event" && x.name === "TradeSettled")!;
  const STEP = 10_000n; // keep each getLogs call inside RPC range limits
  for (let from = BigInt(placed ?? d.deployBlock ?? 0); from <= head; from += STEP) {
    const to = from + STEP - 1n < head ? from + STEP - 1n : head;
    for (const side of [0, 1] as const) {
      const logs = await client.getLogs({
        address: d.dvpSettler,
        event: event as never,
        args: (side === 0 ? { orderHashA: h } : { orderHashB: h }) as never,
        fromBlock: from,
        toBlock: to,
      });
      const log = logs[0] as unknown as { transactionHash: string; args: { memos: readonly bigint[] } } | undefined;
      if (log) {
        const add = dvpNotesFor(o, side, [...log.args.memos]).map((n) => toStored(n, "live"));
        return { tx: log.transactionHash, spent: o.gives.map((g) => commit(g.note).toString()), add };
      }
    }
  }
  if (Date.now() / 1000 > o.expiresAt + 600) return { tx: null, spent: [], add: [], expired: true };
  return null;
}

// ---------------------------------------------------------------- NAV

/** The NAV vault id of a wallet (one vault per manager wallet). */
export const vaultIdOf = (wallet: Address) => keccak256(toBytes(`cordon-vault:${wallet.toLowerCase()}`));

/** A wallet's vault: registration, pending request and the latest attested NAV. */
export async function vaultState(wallet: Address) {
  const d = need();
  const vaultId = vaultIdOf(wallet);
  const [v, req] = await Promise.all([
    readContract(wagmiConfig, { address: d.navAttestor, abi: navAttestorAbi, functionName: "vaults", args: [vaultId] }),
    trpc.nav.request.query(vaultId),
  ]);
  return {
    vaultId,
    registered: v[0] !== zeroAddress,
    requested: Boolean(req),
    epoch: Number(v[2]),
    ts: Number(v[3]),
    navPerShare18: v[4],
    totalShares: v[5],
  };
}

/**
 * Asks governance to register this wallet as a vault manager, holding its own notes.
 * Needs the wallet signed in (Sync workspace): the server takes the id from that wallet.
 */
export async function requestVault(_wallet: Address) {
  const pk = ownerPkOf(await spendingKey());
  await trpc.nav.requestVault.mutate({ vaultPk: hex32(pk) });
}

const feedAbi = [
  { type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] },
] as const;

/**
 * Proves NAV over this wallet's free underlying notes at the latest oracle rounds and
 * attests it from the wallet (the vault manager). Shares are whole units (18 decimals on-chain).
 */
export async function attestNav(p: { wallet: Address; notes: StoredNote[]; shares: bigint; liabilitiesUsd: number }, h: Hooks) {
  const d = need();
  const holdings = p.notes.filter((n) => n.status === "live" && n.kind === "0" && n.lock === "0").map(fromStored);
  if (!holdings.length) throw new Error("No free underlying notes to value.");
  if (holdings.length > 16) throw new Error("NAV covers up to 16 notes; withdraw or merge some first.");
  const [sk, t, v] = await Promise.all([spendingKey(), tree(), vaultState(p.wallet)]);
  if (!v.registered) throw new Error("This vault is not registered yet.");
  const priced: { asset: bigint; price: bigint; roundId: bigint; address: Address }[] = [];
  for (const a of [...new Set(holdings.map((n) => n.asset))]) {
    const asset = addressOf(a);
    const [feed] = await readContract(wagmiConfig, { address: d.priceOracle, abi: priceOracleAbi, functionName: "feeds", args: [asset] });
    const [roundId] = await readContract(wagmiConfig, { address: feed, abi: feedAbi, functionName: "latestRoundData" });
    const price = await readContract(wagmiConfig, { address: d.priceOracle, abi: priceOracleAbi, functionName: "rawPrice", args: [asset, roundId] });
    priced.push({ asset: a, price, roundId, address: asset });
  }
  const epoch = BigInt(v.epoch) + 1n;
  const totalShares = p.shares * 10n ** 18n;
  const liabilities27 = BigInt(Math.round(p.liabilitiesUsd * 1e6)) * 10n ** 21n;
  const value = holdings.reduce((s, n) => s + n.raw * priced.find((x) => x.asset === n.asset)!.price, 0n);
  if (value <= liabilities27) throw new Error("Liabilities exceed the value of the holdings.");
  for (const n of holdings) if (t.indexOf(commit(n)) < 0) throw new Error("Some notes are not indexed yet. Try again in a minute.");
  h.step?.("Proving");
  const { navPerShare, inputs } = navInputs({ tree: t, vaultSk: sk, vaultPk: ownerPkOf(sk), epoch, totalShares, liabilities27, prices: priced, holdings });
  const proof = await prove("nav", inputs);
  h.step?.("Submitted");
  const a = navArgs(proof.publicInputs, { epoch, navPerShare, totalShares, liabilities27, queueUsdg: 0n });
  const prices = Array.from({ length: 16 }, (_, i) => ({ asset: priced[i]?.address ?? zeroAddress, roundId: priced[i]?.roundId ?? 0n }));
  const hash = await writeContract(wagmiConfig, {
    address: d.navAttestor,
    abi: navAttestorAbi,
    functionName: "attest",
    args: [v.vaultId, { ...a, epoch: epoch } as never, prices as never, toHex(proof.proof)],
    chainId: robinhood.id,
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return { tx: hash, epoch: Number(epoch), navPerShare18: navPerShare };
}

// ---------------------------------------------------------------- disclosure

export type Disclosed = {
  scope: string;
  purpose: string;
  until: string;
  notes: (StoredNote & { nullifier: string })[];
};

/** Seals the chosen notes (with their nullifiers, so the viewer can check they are unspent) to a Cordon key. */
export async function grantDisclosure(p: { to: string; scope: string; purpose: string; until: string; notes: StoredNote[] }) {
  const r = parseCordonKey(p.to);
  const sk = await spendingKey();
  const payload: Disclosed = {
    scope: p.scope,
    purpose: p.purpose,
    until: p.until,
    notes: p.notes.map((s) => ({ ...s, nullifier: nullifier(fromStored(s), sk).toString() })),
  };
  const box = await seal(r.pub, payload);
  const { id } = await trpc.disclose.grant.mutate({ viewerPk: p.to.trim().toLowerCase(), scope: p.scope.toLowerCase(), ciphertext: btoa(box) });
  return id;
}

/** Revokes a disclosure grant; its link stops opening. */
export const revokeDisclosure = (id: string) => trpc.disclose.revoke.mutate(id);

/** Opens a disclosure addressed to this wallet and checks each note against the chain. */
export async function openDisclosure(id: string) {
  const g = await trpc.disclose.get.query(id);
  if (!g) throw new Error("This disclosure was revoked or does not exist.");
  const d = await open<Disclosed>((await receivingKey()).privateKey, atob(g.ciphertext)).catch(() => {
    throw new Error("This disclosure is addressed to another Cordon key.");
  });
  const t = await tree();
  const spent = new Set(await trpc.tree.spent.query(d.notes.map((n) => hex32(BigInt(n.nullifier)))));
  return {
    ...d,
    notes: d.notes.map((n) => ({
      ...n,
      valid: commit(fromStored(n)).toString() === n.commit && t.indexOf(BigInt(n.commit)) >= 0,
      spent: spent.has(hex32(BigInt(n.nullifier))),
    })),
  };
}

/** TESTNET ONLY: faucet Stock Tokens / USDG from the deployment (TESTNET_ASSETS). */
export const testAssets: Record<string, Address> =
  (deployment as (Deployment & { testAssets?: Record<string, Address> }) | null)?.testAssets ?? {};

const faucetAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
] as const;

/** Mints testnet faucet tokens to `to` (testnet only). */
export async function faucet(symbol: string, to: Address) {
  const token = testAssets[symbol];
  if (!token) throw new Error(`No test ${symbol} on this network.`);
  const amount = symbol === "USDG" ? 1000n * 10n ** 6n : 100n * 10n ** 18n;
  const hash = await writeContract(wagmiConfig, { address: token, abi: faucetAbi, functionName: "mint", args: [to, amount], chainId: robinhood.id });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return amount;
}
