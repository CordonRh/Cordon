import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  claimNotes,
  commit,
  generateSealKey,
  KIND,
  open,
  ownerPkOf,
  Prover,
  seal,
  underlying,
  type Note,
} from "@cordon/sdk";
import * as wagmiActions from "wagmi/actions";
import { keccak256, toBytes, zeroAddress, type Address } from "viem";

// ---------------------------------------------------------------- fakes for the browser's world

const D = {
  pool: "0x0000000000000000000000000000000000000001",
  bundleVerifier: "0x0000000000000000000000000000000000000002",
  actionEngine: "0x0000000000000000000000000000000000000003",
  assetGate: "0x0000000000000000000000000000000000000004",
  encumbranceRegistry: "0x0000000000000000000000000000000000000005",
  navAttestor: "0x0000000000000000000000000000000000000006",
  priceOracle: "0x0000000000000000000000000000000000000007",
  dvpSettler: "0x0000000000000000000000000000000000000008",
} as const;
const STOCK = "0x00000000000000000000000000000000000000aa" as Address;
const USD = "0x00000000000000000000000000000000000000bb" as Address;
const NOW = 1_800_000_000n; // chain time
const TX = `0x${"77".repeat(32)}` as const;

type Api = Record<string, (input: never) => unknown>;
const w = {
  leaves: [] as bigint[],
  api: {} as Api,
  calls: [] as [string, unknown][],
  reads: {} as Record<string, (args: readonly unknown[]) => unknown>,
  writes: [] as { functionName: string; args: readonly unknown[] }[],
  receipt: "success" as "success" | "reverted",
  sendTransaction: async (): Promise<`0x${string}`> => TX,
  logs: (_args: Record<string, bigint>, _from: bigint) => [] as unknown[],
  head: 20_200n,
};
const call = async (path: string, input: unknown) => {
  w.calls.push([path, input]);
  const f = w.api[path];
  if (!f) throw new Error(`no fake for ${path}`);
  return f(input as never);
};
const trpc = new Proxy(
  {},
  {
    get: (_, a: string) =>
      new Proxy(
        {},
        {
          get: (_, b: string) => ({
            query: (i: unknown) => call(`${a}.${b}`, i),
            mutate: (i: unknown) => call(`${a}.${b}`, i),
          }),
        },
      ),
  },
);

mock.module("./env", () => ({
  env: { deployment: JSON.stringify(D), supabaseUrl: "https://db.test" },
  chainId: 4663,
  backendEnabled: true,
}));
mock.module("./trpc", () => ({ trpc }));
mock.module("./wallet", () => ({
  robinhood: { id: 4663 },
  wagmiConfig: {},
  signWithWallet: async () => `0x${"5a".repeat(65)}`,
}));
mock.module("wagmi/actions", () => ({
  ...wagmiActions,
  getBlock: async () => ({ timestamp: NOW + 30n }),
  readContract: async (_: unknown, p: { functionName: string; args?: readonly unknown[] }) => {
    const f = w.reads[p.functionName];
    if (!f) throw new Error(`no fake read ${p.functionName}`);
    return f(p.args ?? []);
  },
  writeContract: async (_: unknown, p: { functionName: string; args: readonly unknown[] }) => {
    w.writes.push(p);
    return TX;
  },
  waitForTransactionReceipt: async () => ({ status: w.receipt }),
  sendTransaction: async () => w.sendTransaction(),
  getPublicClient: () => ({
    getBlockNumber: async () => w.head,
    getLogs: async (p: { args: Record<string, bigint>; fromBlock: bigint }) =>
      w.logs(p.args, p.fromBlock),
  }),
}));

const c = await import("./cordon");
type StoredNote = import("./cordon").StoredNote;

const st = (n: Note, status: StoredNote["status"] = "live"): StoredNote => ({
  ...(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, String(v)])) as Record<
    keyof Note,
    string
  >),
  commit: commit(n).toString(),
  status,
});
const hex32 = (x: bigint) => `0x${x.toString(16).padStart(64, "0")}`;
const b64hex = (b: string) =>
  Array.from(atob(b), (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
const index = (...ns: Note[]) => w.leaves.push(...ns.map(commit));

const proofPub = Array.from({ length: 120 }, () => "0x00") as `0x${string}`[];
const proveSpy = spyOn(Prover.prototype, "prove").mockImplementation(async () => ({
  proof: new Uint8Array([1]),
  publicInputs: proofPub,
}));
// relay polls and treeWith retries sleep: run them at once.
const timers = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
  fn();
  return 0;
}) as never);
afterAll(() => {
  proveSpy.mockRestore();
  timers.mockRestore();
});

let sk: bigint;
let me: bigint;
const steps: string[] = [];
const kept: { tx: string | null; add: StoredNote[] }[] = [];
const dropped: string[][] = [];
/** Hooks that also play the indexer: kept notes reach the tree. */
const hooks = {
  step: (s: string) => void steps.push(s),
  keep: (ch: { tx: string | null; spent: string[]; add: StoredNote[] }) => {
    kept.push(ch);
    w.leaves.push(...ch.add.map((s) => BigInt(s.commit)));
  },
  drop: (commits: string[]) => void dropped.push(commits),
};

beforeAll(async () => {
  sk = await c.spendingKey();
  me = ownerPkOf(sk);
});

beforeEach(() => {
  w.leaves = [];
  w.calls = [];
  w.writes = [];
  w.receipt = "success";
  w.sendTransaction = async () => TX;
  w.logs = () => [];
  steps.length = kept.length = dropped.length = 0;
  w.api = {
    "tree.leaves": ({ from, limit }: { from: number; limit: number }) =>
      w.leaves.slice(from, from + limit).map((x, i) => ({ leaf: from + i, commit: x.toString() })),
    "relay.submit": () => ({ job: 1 }),
    "relay.status": () => ({ status: "confirmed", tx_hash: TX, attempts: 1 }),
    "inbox.post": () => ({ id: 1 }),
    "encumbrances.requestDefault": () => ({ requested: true }),
    "nav.request": () => null,
    "nav.requestVault": () => ({ requested: true }),
  } as Api;
  w.reads = {
    latest: () => [NOW - 100n, 10n ** 18n],
    claimMask: () => 0b11111,
    indexAt: ([, ts]) => (ts === NOW ? 10n ** 18n : 2n * 10n ** 18n),
  };
});

// ---------------------------------------------------------------- keys and codes

describe("keys", () => {
  test("the spending key is derived once per session from the wallet signature", async () => {
    expect(c.keyReady()).toBe(true);
    expect(await c.spendingKey()).toBe(sk);
    c.forgetKey();
    expect(c.keyReady()).toBe(false);
    expect(await c.spendingKey()).toBe(sk); // same signature, same key
  });

  test("listeners learn the owner key when it is derived and lose it when forgotten (wallet switch)", async () => {
    const seen: (string | undefined)[] = [];
    const off = c.onOwnerChange((o) => seen.push(o));
    c.forgetKey();
    await c.spendingKey();
    off();
    c.forgetKey();
    await c.spendingKey();
    expect(seen).toEqual([undefined, me.toString()]);
  });

  test("a Cordon key round-trips and rejects malformed input", async () => {
    const key = await c.cordonKey();
    expect(key).toMatch(/^0x[0-9a-f]{128}$/);
    const parsed = c.parseCordonKey(` ${key.toUpperCase().replace("0X", "0x")} `);
    expect(parsed.pk).toBe(me);
    expect(b64hex(parsed.pub)).toBe(key.slice(66));
    expect(() => c.parseCordonKey("0x1234")).toThrow("Enter a Cordon key");
  });

  test("a pledge code carries the hash of a release secret only this wallet can compute", async () => {
    const code = await c.pledgeCode();
    const p = c.parsePledgeCode(code);
    expect(p.pk).toBe(me);
    expect(code.slice(0, 130)).toBe(await c.cordonKey());
    expect(p.releaseHash).not.toBe(0n);
    const key = await c.cordonKey();
    expect(() => c.parsePledgeCode(key)).toThrow("pledge code");
  });

  test("stored notes round-trip and vault ids follow the wallet", () => {
    const n = underlying(STOCK, 5n, me, 9n);
    expect(c.fromStored(st(n))).toEqual(n);
    const wallet = "0x00000000000000000000000000000000000000Ab" as Address;
    expect(c.vaultIdOf(wallet)).toBe(keccak256(toBytes(`cordon-vault:${wallet.toLowerCase()}`)));
  });

  test("the deployment is read from the environment", () => {
    expect(c.deployment?.pool).toBe(D.pool);
    expect(c.protocolEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------- deposit, bundle, relay

describe("notes", () => {
  test("deposit approves, deposits and returns a pending note of this wallet", async () => {
    const s = await c.deposit(STOCK, 10n ** 18n);
    expect(w.writes.map((x) => x.functionName)).toEqual(["approve", "deposit"]);
    expect(w.writes[0].args).toEqual([D.pool, 10n ** 18n]);
    expect(s).toMatchObject({
      status: "pending",
      raw: (10n ** 18n).toString(),
      ownerPk: me.toString(),
      kind: "0",
    });
    expect(commit(c.fromStored(s)).toString()).toBe(s.commit);
  });

  test("indexed lists pending notes that reached the tree", async () => {
    const a = underlying(STOCK, 1n, me, 1n);
    const b = underlying(STOCK, 2n, me, 2n);
    expect(await c.indexed([st(a, "live")])).toEqual([]);
    expect(w.calls).toHaveLength(0);
    index(a);
    expect(await c.indexed([st(a, "pending"), st(b, "pending")])).toEqual([commit(a).toString()]);
  });

  test("bundle waits out the standby, then relays the claim notes the mask allows", async () => {
    const u = underlying(STOCK, 10n ** 18n, me, 3n);
    await expect(c.bundle(st(u), hooks)).rejects.toThrow("standby");
    index(u);
    w.reads.claimMask = () => 0b00011;
    const ch = await c.bundle(st(u), hooks);
    expect(ch.tx).toBe(TX);
    expect(ch.spent).toEqual([commit(u).toString()]);
    expect(ch.add.map((s) => s.kind)).toEqual(["1", "2"]);
    expect(
      ch.add.every((s) => s.status === "live" && s.raw === (10n ** 18n - 10n ** 15n).toString()),
    ).toBe(true);
    expect(kept[0].add.every((s) => s.status === "pending")).toBe(true);
    expect(steps).toEqual(["Proving", "Submitted"]);
    expect(w.calls.find(([p]) => p === "relay.submit")![1]).toMatchObject({
      target: D.bundleVerifier,
    });
  });
});

describe("relay", () => {
  const u = underlying(STOCK, 7n, 0n, 4n);
  const withdraw = async () => {
    const n = { ...u, ownerPk: me };
    index(n);
    return c.withdraw(st(n), "0x00000000000000000000000000000000000000d1", hooks, "whole");
  };

  test("withdraw refuses claim and locked notes, and relays a free underlying note", async () => {
    await expect(c.withdraw(st({ ...u, kind: KIND.INCOME }), zeroAddress, hooks, "whole")).rejects.toThrow(
      "Only a free underlying",
    );
    await expect(c.withdraw(st({ ...u, lock: 1n }), zeroAddress, hooks, "whole")).rejects.toThrow(
      "Only a free underlying",
    );
    expect(await withdraw()).toMatchObject({ tx: TX, add: [] });
    expect(w.calls.find(([p]) => p === "relay.submit")![1]).toMatchObject({ target: D.pool });
  });

  test("withdraw checks the amount: 0 and more than the note are refused", async () => {
    const n = { ...u, ownerPk: me };
    await expect(c.withdraw(st(n), zeroAddress, hooks, 0n)).rejects.toThrow("from 1 to 7");
    await expect(c.withdraw(st(n), zeroAddress, hooks, 8n)).rejects.toThrow("from 1 to 7");
    expect(w.calls).toHaveLength(0);
  });

  test("a partial withdraw keeps the rest as a private change note of this wallet", async () => {
    const n = { ...u, ownerPk: me };
    index(n);
    const to = "0x00000000000000000000000000000000000000d1" as Address;
    const ch = await c.withdraw(st(n), to, hooks, 3n);
    expect(ch.spent).toEqual([commit(n).toString()]);
    expect(ch.add).toHaveLength(1);
    expect(ch.add[0]).toMatchObject({ raw: "4", ownerPk: me.toString(), kind: "0", lock: "0", asset: BigInt(STOCK).toString(), status: "live" });
    expect(ch.add[0].blinding).not.toBe(n.blinding.toString());
    expect(commit(c.fromStored(ch.add[0])).toString()).toBe(ch.add[0].commit);
    const [name, inputs] = proveSpy.mock.calls.at(-1) as unknown as [string, Record<string, unknown>];
    expect(name).toBe("transfer");
    expect(inputs).toMatchObject({ withdraw_raw: "3", recipient: BigInt(to).toString(), asset: BigInt(STOCK).toString() });
    const outs = inputs.outs as { raw: string; owner_pk: string; blinding: string }[];
    expect(outs.map((o) => o.raw)).toEqual(["4", "0"]);
    expect(outs[0]).toMatchObject({ owner_pk: me.toString(), blinding: ch.add[0].blinding });
  });

  test("a whole-note withdraw is opt-in: the exact note amount is refused without it", async () => {
    const n = { ...u, ownerPk: me };
    await expect(c.withdraw(st(n), zeroAddress, hooks, 7n)).rejects.toThrow("confirm a whole-note withdrawal");
    expect(w.calls).toHaveLength(0);
  });

  test("withdrawing the whole note with the opt-in makes no change note", async () => {
    const n = { ...u, ownerPk: me };
    index(n);
    const ch = await c.withdraw(st(n), zeroAddress, hooks, "whole");
    expect(ch).toMatchObject({ tx: TX, spent: [commit(n).toString()], add: [] });
    const inputs = proveSpy.mock.calls.at(-1)![1] as unknown as { withdraw_raw: string; outs: { raw: string }[] };
    expect(inputs.withdraw_raw).toBe("7");
    expect(inputs.outs.map((o) => o.raw)).toEqual(["0", "0"]);
  });

  test("a note that never reaches the tree is reported after the retries", async () => {
    await expect(c.withdraw(st({ ...u, ownerPk: me }), zeroAddress, hooks, "whole")).rejects.toThrow(
      "not indexed yet",
    );
    expect(w.calls.filter(([p]) => p === "tree.leaves")).toHaveLength(25);
  });

  test("when the relayer refuses, the wallet submits the call itself", async () => {
    w.api["relay.submit"] = () => {
      throw new Error("rate limited");
    };
    expect(await withdraw()).toMatchObject({ tx: TX });
    expect(dropped).toEqual([]);
  });

  test("a reverted self-submission drops the pending notes and reports the revert", async () => {
    w.api["relay.submit"] = () => {
      throw new Error("rate limited");
    };
    w.receipt = "reverted";
    await expect(withdraw()).rejects.toThrow("reverted");
    expect(dropped).toHaveLength(1);
  });

  test("a wallet error without a message reports the relayer's", async () => {
    w.api["relay.submit"] = () => {
      throw new Error("rate limited");
    };
    w.sendTransaction = async () => {
      throw new Error("");
    };
    await expect(withdraw()).rejects.toThrow("rate limited");
  });

  test("a failed relay drops the notes; a slow one leaves them pending", async () => {
    w.api["relay.status"] = () => ({ status: "failed", tx_hash: null, attempts: 3 });
    await expect(withdraw()).rejects.toThrow("could not settle");
    expect(dropped).toHaveLength(1);
    w.api["relay.status"] = () => null;
    await expect(withdraw()).rejects.toThrow("Still waiting");
    expect(dropped).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- income, term, unbundle

describe("claims", () => {
  const jBundle = 10n ** 18n;
  const claims = () =>
    claimNotes(underlying(STOCK, 1000n, me, 5n), 0n, jBundle, NOW - 1000n, [
      11n,
      12n,
      13n,
      14n,
      15n,
    ]);

  test("claimIncome refuses non-income notes, notes before their term, and nothing accrued", async () => {
    const [p, i] = claims();
    await expect(c.claimIncome(st(p), hooks)).rejects.toThrow("Only a free INCOME");
    const later = { ...i, termFrom: NOW + 86_400n, accruedTo: 0n };
    index(later);
    await expect(c.claimIncome(st(later), hooks)).rejects.toThrow("starts on");
    index(i);
    w.reads.indexAt = () => 5n;
    await expect(c.claimIncome(st(i), hooks)).rejects.toThrow("No income has accrued");
  });

  test("claimIncome pays out what accrued and moves the note forward", async () => {
    const [, i] = claims();
    index(i);
    const ch = await c.claimIncome(st(i), hooks);
    expect(ch.spent).toEqual([commit(i).toString()]);
    expect(ch.add).toHaveLength(2);
    expect(ch.add[0]).toMatchObject({ kind: "2", accruedTo: NOW.toString() });
    expect(ch.add[1]).toMatchObject({ kind: "0", raw: "1000" }); // 1000 * (2e18 - 1e18) / 1e18
  });

  test("claimIncome stops at the end of the term; a forced claim with nothing due keeps only the note", async () => {
    const [, i] = claims();
    const termed = { ...i, termUntil: NOW - 10n };
    index(termed);
    w.reads.indexAt = () => 5n;
    const ch = await c.claimIncome(st(termed), hooks, { force: true });
    expect(ch.add).toHaveLength(1);
    expect(ch.add[0].accruedTo).toBe((NOW - 10n).toString());
  });

  test("setIncomeTerm splits an income note at a future date", async () => {
    const [, i] = claims();
    index(i);
    await expect(c.setIncomeTerm(st(i), NOW, hooks)).rejects.toThrow("future");
    const ch = await c.setIncomeTerm(st(i), NOW + 100n, hooks);
    expect(ch.add.map((s) => [s.termFrom, s.termUntil])).toEqual([
      ["0", (NOW + 100n).toString()],
      [(NOW + 100n).toString(), "0"],
    ]);
  });

  test("unbundle refuses missing or not-yet-started claims", async () => {
    const all = claims().map((n) => st(n));
    await expect(c.unbundle(all, "999", hooks)).rejects.toThrow("No free claims");
    await expect(
      c.unbundle(
        all.filter((s) => s.kind !== "3"),
        all[0].bundleId,
        hooks,
      ),
    ).rejects.toThrow("VOTE claim");
    const [p, i] = claims();
    const remainder = st({ ...i, termFrom: NOW + 86_400n });
    w.reads.claimMask = () => 0b00011;
    await expect(c.unbundle([st(p), remainder], all[0].bundleId, hooks)).rejects.toThrow(
      "income remainder starts",
    );
  });

  test("unbundle recombines the claims into an underlying note", async () => {
    const [p, i] = claims();
    index(p, i);
    w.reads.claimMask = () => 0b00011;
    w.reads.latest = () => [NOW - 2000n, 2n * jBundle];
    const ch = await c.unbundle(
      [st(p), st(i), st({ ...i, blinding: 99n }, "spent")],
      st(p).bundleId,
      hooks,
    );
    expect(ch.spent).toEqual([commit(p).toString(), commit(i).toString()]);
    expect(ch.add[0]).toMatchObject({ kind: "0", raw: "2000", asset: BigInt(STOCK).toString() });
  });

  test("unbundle first catches the income up to the latest checkpoint", async () => {
    const [p, i] = claims();
    index(p, i);
    w.reads.claimMask = () => 0b00011;
    w.reads.latest = () => [NOW + 50n, jBundle];
    const ch = await c.unbundle([st(p), st(i)], st(p).bundleId, hooks);
    // The catch-up claim was kept, then its new income note was spent by the unbundle.
    const caughtUp = kept.find((k) => k.add[0]?.accruedTo === (NOW + 50n).toString())!;
    expect(caughtUp).toBeDefined();
    expect(ch.spent).toEqual([commit(p).toString(), caughtUp.add[0].commit]);
  });
});

// ---------------------------------------------------------------- encumbrances

describe("encumbrances", () => {
  const free = () => underlying(STOCK, 500n, me, 21n);
  const encState =
    (s: Partial<Record<"exists" | "released" | "defaulted" | "enforced", boolean>>) => () => [
      s.exists ?? true,
      0,
      0n,
      0n,
      s.released ?? false,
      s.defaulted ?? false,
      s.enforced ?? false,
      0n,
    ];

  test("a LOCKUP needs a future end and locks the note to its encumbrance", async () => {
    const n = free();
    index(n);
    await expect(c.encumber(st(n), { kind: "LOCKUP", until: NOW }, hooks)).rejects.toThrow(
      "future",
    );
    const ch = await c.encumber(st(n), { kind: "LOCKUP", until: NOW + 10n }, hooks);
    const locked = ch.add[0];
    const enc = JSON.parse(locked.enc!);
    expect(enc).toMatchObject({
      kind: "0",
      until: (NOW + 10n).toString(),
      tranchePk: [],
      releaseHash: "0",
    });
    expect(w.calls.some(([p]) => p === "inbox.post")).toBe(false);
  });

  test("a pledge refuses a bad holder code", async () => {
    await expect(
      c.encumber(st(free()), { kind: "PLEDGE", until: NOW + 10n, holder: "nope" }, hooks),
    ).rejects.toThrow("pledge code");
  });

  describe("pledge lifecycle (this wallet as both owner and holder)", () => {
    let held: import("./cordon").Held;
    let locked: StoredNote;

    beforeEach(async () => {
      const n = free();
      index(n);
      const boxes: string[] = [];
      w.api["inbox.post"] = ({ box }: { box: string }) => (boxes.push(box), { id: boxes.length });
      const ch = await c.encumber(
        st(n),
        { kind: "PLEDGE", until: NOW + 10n, holder: await c.pledgeCode(), obligation: "repay 500" },
        hooks,
      );
      locked = ch.add[0];
      w.api["inbox.since"] = ({ after }: { after: number }) =>
        boxes.map((box, k) => ({ id: k + 1, box })).filter((r) => r.id > after);
      const { items, cursor } = await c.readInbox(0);
      expect(cursor).toBe(1);
      held = items[0] as import("./cordon").Held;
      expect(held.locked.commit).toBe(locked.commit);
    });

    test("the holder's terms arrive first and match the locked note", () => {
      expect(c.heldCommit(held)).toBe(locked.lock);
      expect(JSON.parse(held.enc).tranchePk).toEqual([me.toString()]);
      expect(JSON.parse(held.enc).obligation).not.toBe("0");
    });

    test("heldState follows the chain and checks the locked leaf", async () => {
      w.reads.encumbrances = encState({ exists: false });
      expect(await c.heldState(held)).toBe("pending");
      w.reads.encumbrances = encState({});
      expect(await c.heldState(held)).toBe("active");
      w.reads.encumbrances = encState({ released: true });
      expect(await c.heldState(held)).toBe("released");
      w.reads.encumbrances = encState({ defaulted: true });
      expect(await c.heldState(held)).toBe("defaulted");
      w.reads.encumbrances = encState({ enforced: true });
      expect(await c.heldState(held)).toBe("enforced");
      w.leaves = [];
      expect(await c.heldState(held)).toBe("invalid");
      const enc = JSON.parse(held.enc);
      expect(await c.heldState({ ...held, enc: JSON.stringify({ ...enc, kind: "0" }) })).toBe(
        "invalid",
      );
    });

    test("release, default request and enforcement", async () => {
      const r = await c.release(held, hooks);
      expect(r).toMatchObject({ tx: TX, spent: [], add: [] });
      await c.requestDefault(held);
      expect(w.calls.find(([p]) => p === "encumbrances.requestDefault")![1]).toBe(
        hex32(BigInt(c.heldCommit(held))),
      );
      w.reads.encumbrances = encState({});
      await expect(c.enforce(held, hooks)).rejects.toThrow("No default");
      w.reads.encumbrances = encState({ defaulted: true });
      const ch = await c.enforce(held, hooks);
      expect(ch.add[0]).toMatchObject({ raw: "500", lock: "0", ownerPk: me.toString() });
    });

    test("unlock: not released, enforced, then released", async () => {
      await expect(c.unlock({ ...locked, enc: undefined }, hooks)).rejects.toThrow(
        "not in your workspace",
      );
      w.reads.isReleased = () => false;
      w.reads.encumbrances = encState({});
      await expect(c.unlock(locked, hooks)).rejects.toThrow("holder has not released");
      w.reads.encumbrances = encState({ enforced: true });
      expect(await c.unlock(locked, hooks)).toMatchObject({
        tx: null,
        spent: [locked.commit],
        add: [],
      });
      w.reads.isReleased = () => true;
      w.reads.encumbrances = encState({ released: true });
      const ch = await c.unlock(locked, hooks);
      expect(ch.add[0]).toMatchObject({ lock: "0", raw: "500" });
    });
  });

  test("an unreleased LOCKUP says when it ends", async () => {
    const n = free();
    index(n);
    const { add } = await c.encumber(st(n), { kind: "LOCKUP", until: NOW + 10n }, hooks);
    w.reads.isReleased = () => false;
    w.reads.encumbrances = encState({});
    await expect(c.unlock(add[0], hooks)).rejects.toThrow("Locked until");
  });
});

// ---------------------------------------------------------------- inbox and send

describe("inbox", () => {
  test("keeps only this wallet's notes, holder terms it can release, and DvP results", async () => {
    const pub = c.parseCordonKey(await c.cordonKey()).pub;
    const mine = underlying(STOCK, 1n, me, 31n);
    const theirs = underlying(STOCK, 1n, 12345n, 32n);
    const forged = { ...st(mine), raw: "999" };
    const enc = {
      kind: "1",
      until: "1",
      obligation: "0",
      tranchePk: [me.toString()],
      trancheCap: ["1"],
      releaseHash: "1",
      claim: "0",
      blinding: "0",
    };
    const boxes = [
      ...Array.from({ length: 1000 }, () => "garbage"),
      await seal(pub, { t: "notes", add: [st(mine), st(theirs), forged] }),
      await seal(pub, { t: "held", enc: JSON.stringify(enc), locked: st(mine), nonce: "5" }), // wrong release hash
      await seal(pub, { t: "held", enc: JSON.stringify(enc), locked: st(mine), nonce: "" }),
      await seal(pub, { t: "dvp", ref: "r1", failed: true }),
      await seal((await generateSealKey()).publicKey, { t: "notes", add: [st(mine)] }),
    ];
    w.api["inbox.since"] = ({ after }: { after: number }) =>
      boxes
        .map((box, k) => ({ id: k + 1, box }))
        .filter((r) => r.id > after)
        .slice(0, 1000);
    const { cursor, items } = await c.readInbox(0);
    expect(cursor).toBe(boxes.length);
    expect(items).toEqual([
      { t: "notes", add: [st(mine)] },
      { t: "dvp", ref: "r1", failed: true },
    ]);
  });

  test("send checks the note and amount, posts the recipient's note, and keeps the change", async () => {
    const n = underlying(STOCK, 100n, me, 41n);
    index(n);
    const to = await c.cordonKey();
    await expect(c.send(st({ ...n, lock: 1n }), 1n, to, hooks)).rejects.toThrow("locked");
    await expect(c.send(st(n), 0n, to, hooks)).rejects.toThrow("from 1 to 100");
    await expect(c.send(st(n), 101n, to, hooks)).rejects.toThrow("from 1 to 100");
    const ch = await c.send(st(n), 30n, to, hooks);
    expect(ch.add).toHaveLength(1);
    expect(ch.add[0]).toMatchObject({ raw: "70", status: "live" });
    const box = (w.calls.find(([p]) => p === "inbox.post")![1] as { box: string }).box;
    w.api["inbox.since"] = ({ after }: { after: number }) => (after ? [] : [{ id: 1, box }]);
    const { items } = await c.readInbox(0);
    expect(items).toEqual([
      {
        t: "notes",
        add: [expect.objectContaining({ raw: "30", ownerPk: me.toString(), status: "pending" })],
      },
    ]);
    const all = await c.send(st(n), 100n, to, hooks);
    expect(all.add).toEqual([]);
  });
});

// ---------------------------------------------------------------- DvP

describe("dvp orders", () => {
  const usdc = (raw: bigint, b: bigint) => st(underlying(USD, raw, me, b));
  let seqKey: Awaited<ReturnType<typeof generateSealKey>>;
  beforeAll(async () => {
    seqKey = await generateSealKey();
  });
  beforeEach(() => {
    w.api["dvp.quote"] = () => ({
      toleranceBps: 50,
      prices: [
        { asset: USD, roundId: "1", price: (10n ** 21n).toString() },
        { asset: STOCK, roundId: "1", price: (10n ** 11n).toString() },
      ],
    });
    w.api["dvp.key"] = () => ({ publicKey: seqKey.publicKey, attestation: null });
    w.api["dvp.submit"] = () => ({ accepted: true, batchEta: 60 });
  });

  test("refuses without enough free notes, with too many notes, or without prices", async () => {
    const order = { give: USD, raw: 100n, want: STOCK, ref: "r" };
    await expect(c.placeOrder({ ...order, notes: [usdc(50n, 1n)] })).rejects.toThrow("Not enough");
    const nine = Array.from({ length: 9 }, (_, k) => usdc(1n, BigInt(k + 1)));
    await expect(c.placeOrder({ ...order, raw: 9n, notes: nine })).rejects.toThrow(
      "Too many notes",
    );
    w.api["dvp.quote"] = () => ({ toleranceBps: 50, prices: [] });
    await expect(c.placeOrder({ ...order, notes: [usdc(100n, 1n)] })).rejects.toThrow(
      "No current price",
    );
  });

  test("places a sealed order the sequencer can open, and recovers its result from the chain", async () => {
    const notes = [
      usdc(60n * 10n ** 6n, 1n),
      { ...usdc(1n, 2n), status: "spent" as const },
      usdc(60n * 10n ** 6n, 3n),
    ];
    w.head = 123n;
    const json = await c.placeOrder(
      { notes, give: USD, raw: 100n * 10n ** 6n, want: STOCK, ref: "ord-1" },
      hooks,
    );
    const box = (w.calls.find(([p]) => p === "dvp.submit")![1] as { encryptedLegs: string })
      .encryptedLegs;
    const sealed = await open<{
      ref: string;
      reply: string;
      wantMin: bigint;
      gives: { amount: bigint }[];
    }>(seqKey.privateKey, box);
    expect(sealed.ref).toBe("ord-1");
    expect(sealed.gives.map((g) => g.amount)).toEqual([60n * 10n ** 6n, 40n * 10n ** 6n]);
    expect(sealed.wantMin).toBe((10n ** 18n * 99n) / 100n); // $100 of a $100 share, less 1%
    expect(JSON.parse(json).placedBlock).toBe(123);

    // Not settled yet, still live.
    w.head = 20_200n;
    const froms: bigint[] = [];
    w.logs = (_args, from) => (froms.push(from), []);
    expect(await c.recoverOrder(json)).toBeNull();
    expect(froms).toEqual([123n, 123n, 10_123n, 10_123n, 20_123n, 20_123n]);

    // Settled as side B: change on the second note, and the shares received.
    w.logs = (args) =>
      "orderHashB" in args
        ? [{ transactionHash: TX, args: { memos: Array.from({ length: 16 }, () => 0n) } }]
        : [];
    const got = await c.recoverOrder(json);
    expect(got).toMatchObject({ tx: TX });
    expect(got!.spent).toHaveLength(2);
    expect(got!.add.map((s) => s.raw)).toEqual([(20n * 10n ** 6n).toString()]);

    // Expired and never settled.
    w.logs = () => [];
    const expired = JSON.stringify({ ...JSON.parse(json), expiresAt: 0 });
    expect(await c.recoverOrder(expired)).toEqual({ tx: null, spent: [], add: [], expired: true });
  });
});

// ---------------------------------------------------------------- NAV

describe("nav", () => {
  const wallet = "0x00000000000000000000000000000000000000a1" as Address;
  const vault =
    (manager: Address, epoch = 3n) =>
    () => [manager, 0n, epoch, 7n, 10n ** 18n, 10n ** 18n, 0n, 0n];

  test("vaultState and requestVault", async () => {
    w.reads.vaults = vault(zeroAddress);
    expect(await c.vaultState(wallet)).toMatchObject({
      registered: false,
      requested: false,
      epoch: 3,
      ts: 7,
    });
    w.api["nav.request"] = () => ({ scheduled: false });
    w.reads.vaults = vault(wallet);
    expect(await c.vaultState(wallet)).toMatchObject({
      registered: true,
      requested: true,
      vaultId: c.vaultIdOf(wallet),
    });
    await c.requestVault(wallet);
    expect(w.calls.at(-1)).toEqual(["nav.requestVault", { vaultPk: hex32(me) }]);
  });

  test("attestNav values free notes at the latest rounds and attests from the wallet", async () => {
    const n = underlying(STOCK, 10n ** 18n, me, 51n);
    const p = { wallet, notes: [st(n)], shares: 10n, liabilitiesUsd: 1 };
    w.reads.vaults = vault(wallet);
    w.reads.feeds = () => ["0x00000000000000000000000000000000000000fe", 3600];
    w.reads.latestRoundData = () => [9n, 0n, 0n, 0n, 9n];
    w.reads.rawPrice = () => 10n ** 11n; // $100 per share
    await expect(c.attestNav({ ...p, notes: [] }, hooks)).rejects.toThrow("No free underlying");
    await expect(
      c.attestNav({ ...p, notes: Array.from({ length: 17 }, () => st(n)) }, hooks),
    ).rejects.toThrow("up to 16");
    await expect(c.attestNav({ ...p, liabilitiesUsd: 100 }, hooks)).rejects.toThrow(
      "Liabilities exceed",
    );
    await expect(c.attestNav(p, hooks)).rejects.toThrow("not indexed");
    index(n);
    const r = await c.attestNav(p, hooks);
    expect(r).toEqual({
      tx: TX,
      epoch: 4,
      navPerShare18: ((10n ** 29n - 10n ** 27n) * 10n ** 9n) / 10n ** 19n,
    });
    const attest = w.writes.find((x) => x.functionName === "attest")!;
    expect(attest.args[0]).toBe(c.vaultIdOf(wallet));
    expect((attest.args[2] as { roundId: bigint }[])[0].roundId).toBe(9n);
    w.reads.vaults = vault(zeroAddress);
    await expect(c.attestNav(p, hooks)).rejects.toThrow("not registered");
  });
});

// ---------------------------------------------------------------- disclosure

describe("disclosure", () => {
  test("grant seals notes with nullifiers to the viewer; open checks them against the chain", async () => {
    const a = underlying(STOCK, 1n, me, 61n);
    const b = underlying(STOCK, 2n, me, 62n);
    index(a);
    let ciphertext = "";
    w.api["disclose.grant"] = (i: { ciphertext: string; viewerPk: string; scope: string }) => (
      (ciphertext = i.ciphertext),
      { id: "g1" }
    );
    const to = await c.cordonKey();
    expect(
      await c.grantDisclosure({
        to: ` ${to} `,
        scope: "Audit",
        purpose: "p",
        until: "2030",
        notes: [st(a), st(b)],
      }),
    ).toBe("g1");
    expect(w.calls.at(-1)![1]).toMatchObject({ viewerPk: to, scope: "audit" });

    w.api["disclose.get"] = () => ({ scope: "audit", viewer_pk: to, ciphertext });
    let spentQuery: string[] = [];
    w.api["tree.spent"] = (q: string[]) => ((spentQuery = q), [q[1]]);
    const d = await c.openDisclosure("g1");
    expect(spentQuery).toHaveLength(2);
    expect(d.notes.map((n) => [n.valid, n.spent])).toEqual([
      [true, false],
      [false, true],
    ]);

    w.api["disclose.get"] = () => null;
    await expect(c.openDisclosure("g1")).rejects.toThrow("revoked or does not exist");
    w.api["disclose.get"] = () => ({ ciphertext: btoa("x") });
    await expect(c.openDisclosure("g1")).rejects.toThrow("another Cordon key");

    w.api["disclose.revoke"] = () => ({ revoked: true });
    expect(await c.revokeDisclosure("g1")).toEqual({ revoked: true });
  });
});
