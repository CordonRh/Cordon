import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h2, initHasher } from "./hash";
import { commit, emptyNote, ENC_KIND, holderTermsOk, ownerPkOf, underlying, type Encumbrance } from "./note";
import { Prover } from "./prover";
import { transferArgs, transferInputs } from "./builders";
import { NoteTree } from "./tree";

const circuits = join(import.meta.dir, "../../../public/circuits");

beforeAll(async () => {
  await initHasher();
});

test("poseidon2 matches the Noir and Solidity vector", () => {
  expect(h2(1n, 2n)).toBe(0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383n);
});

test(
  "SDK proves a withdrawal the circuit accepts",
  async () => {
    const sk = 0x1234567n;
    const pk = ownerPkOf(sk);
    const asset = "0x00000000000000000000000000000000000000aa" as const;
    const note = underlying(asset, 1000n, pk, 11n);
    const tree = new NoteTree([commit(note)]);
    const change = underlying(asset, 600n, pk, 12n);
    const recipient = "0x00000000000000000000000000000000000000bb" as const;

    const prover = new Prover(async (name) => JSON.parse(readFileSync(join(circuits, `${name}.json`), "utf8")));
    const inputs = transferInputs({
      tree,
      now: 1_800_000_000n,
      sk,
      ins: [note, emptyNote(13n)],
      outs: [change, emptyNote(14n)],
      withdrawRaw: 400n,
      recipient,
    });
    const p = await prover.prove("transfer", inputs);
    expect(await prover.verify("transfer", p)).toBe(true);

    const args = transferArgs(p.publicInputs, asset, 400n, recipient);
    expect(args.root).toBe(tree.root);
    expect(args.commits[0]).toBe(commit(change));
  },
  { timeout: 120_000 },
);

test(
  "a private send names no asset: the proof's public asset is 0",
  async () => {
    const sk = 0x1234567n;
    const pk = ownerPkOf(sk);
    const asset = "0x00000000000000000000000000000000000000aa" as const;
    const note = underlying(asset, 1000n, pk, 11n);
    const tree = new NoteTree([commit(note)]);
    const toThem = underlying(asset, 300n, ownerPkOf(0x999n), 21n);
    const change = underlying(asset, 700n, pk, 22n);

    const prover = new Prover(async (name) => JSON.parse(readFileSync(join(circuits, `${name}.json`), "utf8")));
    const p = await prover.prove(
      "transfer",
      transferInputs({ tree, now: 1_800_000_000n, sk, ins: [note, emptyNote(13n)], outs: [toThem, change] }),
    );
    expect(await prover.verify("transfer", p)).toBe(true);
    expect(BigInt(p.publicInputs[2])).toBe(0n); // asset
    expect(BigInt(p.publicInputs[3])).toBe(0n); // withdraw_raw
  },
  { timeout: 120_000 },
);

test(
  "SDK NAV inputs prove: $1,500 of holdings - $100 owed over 1,000 shares = $1.40",
  async () => {
    const { navInputs, navArgs } = await import("./builders");
    const sk = 0xfa017n;
    const pk = ownerPkOf(sk);
    const STOCK = 0xaan;
    const USD = 0xbbn;
    const notes = [underlying(STOCK, 10n * 10n ** 18n, pk, 1n), underlying(USD, 500_000_000n, pk, 2n)];
    const tree = new NoteTree(notes.map(commit));
    const { navPerShare, inputs } = navInputs({
      tree,
      vaultSk: sk,
      vaultPk: pk,
      epoch: 1n,
      totalShares: 1000n * 10n ** 18n,
      liabilities27: 100n * 10n ** 27n,
      prices: [
        { asset: STOCK, price: 10n ** 11n },
        { asset: USD, price: 10n ** 21n },
      ],
      holdings: notes,
    });
    expect(navPerShare).toBe(14n * 10n ** 17n);

    const prover = new Prover(async (name) => JSON.parse(readFileSync(join(circuits, `${name}.json`), "utf8")));
    const p = await prover.prove("nav", inputs);
    expect(await prover.verify("nav", p)).toBe(true);
    const a = navArgs(p.publicInputs, { epoch: 1n, navPerShare, totalShares: 1n, liabilities27: 0n, queueUsdg: 0n });
    expect(a.root).toBe(tree.root);
    expect(a.nullifiers.filter((n) => n !== 0n)).toHaveLength(2);
  },
  { timeout: 180_000 },
);

test("a seeded receiving key is stable and opens what was sealed to it", async () => {
  const { open, seal, sealKeyFromSeed } = await import("./sealed");
  const seed = new Uint8Array(32).fill(7);
  const [a, b] = [await sealKeyFromSeed(seed), await sealKeyFromSeed(seed)];
  expect(a.publicKey).toBe(b.publicKey);
  expect(atob(a.publicKey).length).toBe(32);
  const box = await seal(a.publicKey, { raw: 5n, memo: "hi" });
  expect(await open<{ raw: bigint; memo: string }>(b.privateKey, box)).toEqual({ raw: 5n, memo: "hi" });
});

test("a holder accepts only a pledge or lien that gives it the whole locked note", () => {
  const me = 7n;
  const enc = (kind: bigint, cap: bigint, pk = me): Encumbrance => ({
    kind, until: 0n, obligation: 0n, tranchePk: [pk], trancheCap: [cap], releaseHash: 1n, claim: 0n, blinding: 2n,
  });
  expect(holderTermsOk(enc(ENC_KIND.PLEDGE, 1000n), me, 1000n)).toBe(true);
  expect(holderTermsOk(enc(ENC_KIND.LIEN, 2000n), me, 1000n)).toBe(true);
  expect(holderTermsOk(enc(ENC_KIND.PLEDGE, 1n), me, 1000n)).toBe(false); // 999 would go back to the pledgor
  expect(holderTermsOk(enc(ENC_KIND.LOCKUP, 1000n), me, 1000n)).toBe(false); // releases itself
  expect(holderTermsOk(enc(ENC_KIND.PLEDGE, 1000n, 8n), me, 1000n)).toBe(false); // someone else first
  expect(holderTermsOk({ ...enc(ENC_KIND.PLEDGE, 0n), tranchePk: [], trancheCap: [] }, me, 1n)).toBe(false);
});
