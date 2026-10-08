import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keccak256, toBytes } from "viem";

import { fakeDb, fakes, withEnv, type Query, type Reply } from "../fakes";
import { appRouter } from "./router";
import { adminDb } from "./trpc";

// Every mutation refuses an unauthorized caller or an invalid input before it touches the
// database (a stub client that throws on use proves nothing was reached).
const db = new Proxy(
  {},
  {
    get: () => {
      throw new Error("database reached");
    },
  },
) as SupabaseClient;
const anon = appRouter.createCaller({
  supabase: db,
  userId: null,
  wallet: null,
  ip: "203.0.113.7",
});
const signedIn = appRouter.createCaller({
  supabase: db,
  userId: "u1",
  wallet: null,
  ip: "203.0.113.7",
});
const offline = appRouter.createCaller({
  supabase: null,
  userId: null,
  wallet: null,
  ip: "203.0.113.7",
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );
const hash = `0x${"ab".repeat(32)}`;

describe("unauthorized callers", () => {
  test("wallet-only mutations need a signed-in wallet", async () => {
    expect(await code(anon.workspace.put({} as never))).toBe("UNAUTHORIZED");
    expect(await code(anon.nav.requestVault({ vaultPk: hash }))).toBe("UNAUTHORIZED");
    expect(
      await code(anon.disclose.grant({ viewerPk: hash, scope: "notes", ciphertext: "AA==" })),
    ).toBe("UNAUTHORIZED");
    expect(await code(anon.disclose.revoke("6f1c3b6e-1c1a-4c1e-9d55-6b0f1f1f1f1f"))).toBe(
      "UNAUTHORIZED",
    );
  });

  test("a session without a web3 identity cannot request a vault", async () => {
    expect(await code(signedIn.nav.requestVault({ vaultPk: hash }))).toBe("UNAUTHORIZED");
  });

  test("nothing runs without a configured backend", async () => {
    expect(await code(offline.inbox.post({ box: "AA==" }))).toBe("PRECONDITION_FAILED");
  });
});

describe("invalid inputs", () => {
  test("each mutation rejects malformed input", async () => {
    expect(await code(signedIn.workspace.put({ ciphertext: "not base64!" } as never))).toBe(
      "BAD_REQUEST",
    );
    expect(await code(signedIn.nav.requestVault({ vaultPk: "0x12" }))).toBe("BAD_REQUEST");
    expect(await code(anon.encumbrances.requestDefault("not-a-hash"))).toBe("BAD_REQUEST");
    expect(await code(anon.relay.submit({ target: "0x1234", data: "0xzz" }))).toBe("BAD_REQUEST");
    expect(await code(anon.dvp.submit({ encryptedLegs: "x".repeat(200_001) }))).toBe("BAD_REQUEST");
    expect(
      await code(signedIn.disclose.grant({ viewerPk: "0x1", scope: "Bad Scope", ciphertext: "!" })),
    ).toBe("BAD_REQUEST");
    expect(await code(signedIn.disclose.revoke("not-a-uuid"))).toBe("BAD_REQUEST");
    expect(await code(anon.inbox.post({ box: "<script>" }))).toBe("BAD_REQUEST");
    expect(await code(anon.inbox.post({ box: "A".repeat(12_001) }))).toBe("BAD_REQUEST");
  });
});

// ---------------------------------------------------------------- happy paths and refusals with a fake database

const WALLET = "0x00000000000000000000000000000000000000a1";
const ASSET = "0x00000000000000000000000000000000000000AA";
const asset = {
  asset: ASSET.toLowerCase(),
  symbol: "NVDA",
  name: "NVIDIA",
  class: "STOCK8056",
  claim_types: ["PRINCIPAL", "INCOME"],
  templates: ["LOCKUP"],
  multiplier: "1",
  next_mult: null,
  next_at: null,
  mode: "ACTIVE",
};

let restoreEnv: () => void = () => {};
let userAnswer: (q: Query) => Reply = () => undefined;
let adminAnswer: (q: Query) => Reply = () => undefined;
const user = fakeDb((q) => userAnswer(q));
const admin = fakeDb((q) =>
  q.table === "rpc:rate_take" ? (adminAnswer(q) ?? { data: true }) : adminAnswer(q),
);
const caller = (userId: string | null = "u1", wallet: string | null = WALLET) =>
  appRouter.createCaller({ supabase: user.client, userId, wallet, ip: "203.0.113.7" });
const quiet = () => spyOn(console, "error").mockImplementation(() => {});
const upper = (h: string) => `0x${h.slice(2).toUpperCase()}`;
const eqs = (q: Query) => q.calls.filter(([n]) => n === "eq").map(([, a]) => a);
const rpcArg = (log: Query[], name: string) =>
  log.find((q) => q.table === `rpc:${name}`)?.calls[0][1][0];

describe("adminDb", () => {
  test("refuses when the service role is not configured", () => {
    const restore = withEnv({
      SUPABASE_URL: undefined,
      VITE_SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });
    expect(() => adminDb()).toThrow("not configured");
    restore();
  });
});

describe("procedures", () => {
  beforeAll(() => {
    restoreEnv = withEnv({
      SUPABASE_URL: "https://db.test",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      RPC_URL_4663: undefined,
      VITE_RPC_URL_4663: undefined,
      CORDON_DEPLOYMENT: undefined,
      SEQUENCER_URL: undefined,
      SEQUENCER_SEAL_SEED: undefined,
    });
    fakes.supabase = () => admin.client;
  });
  afterAll(() => {
    restoreEnv();
    fakes.supabase = null;
    fakes.publicClient = null;
  });
  const reset = (
    u: (q: Query) => Reply = () => undefined,
    a: (q: Query) => Reply = () => undefined,
  ) => {
    userAnswer = u;
    adminAnswer = a;
    user.log.length = 0;
    admin.log.length = 0;
  };
  const limitAll = (q: Query) => (q.table === "rpc:rate_take" ? { data: false } : undefined);

  test("assets: list, get, missing and database errors", async () => {
    reset((q) => ({ data: q.arg("eq") ? asset : [asset] }));
    expect(await caller().assets.list()).toEqual([asset] as never);
    expect(await caller().assets.get(ASSET)).toEqual(asset as never);
    expect(user.log.at(-1)!.arg("eq")).toEqual(["asset", ASSET.toLowerCase()]);
    reset(() => ({ data: null }));
    expect(await caller().assets.get(ASSET)).toBeNull();
    expect(await caller().assets.list()).toEqual([]);
    const err = quiet();
    reset(() => ({ error: { message: "boom" } }));
    expect(await code(caller().assets.get(ASSET))).toBe("INTERNAL_SERVER_ERROR");
    expect(await code(caller().assets.list())).toBe("INTERNAL_SERVER_ERROR");
    err.mockRestore();
  });

  test("income index is per asset, newest first", async () => {
    reset(() => ({ data: [{ ts: 2 }, { ts: 1 }] }));
    expect(await caller().income.index(ASSET)).toEqual([{ ts: 2 }, { ts: 1 }] as never);
    expect(user.log[0].arg("order")).toEqual(["ts", { ascending: false }]);
  });

  test("nav.requestVault binds the vault to the signed-in wallet, not the request", async () => {
    reset();
    const r = await caller().nav.requestVault({ vaultPk: upper(hash) });
    expect(r).toEqual({ requested: true, vaultId: keccak256(toBytes(`cordon-vault:${WALLET}`)) });
    expect(rpcArg(admin.log, "request_vault")).toEqual({
      vault: r.vaultId.toLowerCase(),
      manager: WALLET,
      pk: hash,
    });
    const keys = admin.log
      .filter((q) => q.table === "rpc:rate_take")
      .map((q) => (q.calls[0][1][0] as { key: string }).key);
    expect(keys).toEqual(["vault:203.0.113.7", `vault-wallet:${WALLET}`]);
  });

  test("nav.requestVault refuses past the per-IP or per-wallet limit, and on database errors", async () => {
    const limited = (bucket: string) => (q: Query) =>
      q.table === "rpc:rate_take"
        ? { data: !(q.calls[0][1][0] as { key: string }).key.startsWith(bucket) }
        : undefined;
    reset(undefined, limited("vault:"));
    expect(await code(caller().nav.requestVault({ vaultPk: hash }))).toBe("TOO_MANY_REQUESTS");
    reset(undefined, limited("vault-wallet:"));
    expect(await code(caller().nav.requestVault({ vaultPk: hash }))).toBe("TOO_MANY_REQUESTS");
    expect(admin.log.some((q) => q.table === "rpc:request_vault")).toBe(false);
    const err = quiet();
    reset(undefined, (q) =>
      q.table === "rpc:rate_take" ? { error: { message: "down" } } : undefined,
    );
    expect(await code(caller().nav.requestVault({ vaultPk: hash }))).toBe("INTERNAL_SERVER_ERROR");
    reset(undefined, (q) =>
      q.table === "rpc:request_vault" ? { error: { message: "dup" } } : undefined,
    );
    expect(await code(caller().nav.requestVault({ vaultPk: hash }))).toBe("INTERNAL_SERVER_ERROR");
    err.mockRestore();
  });

  test("nav reads: request, list and one vault with its history", async () => {
    reset((q) => ({
      data: q.table === "nav_history" ? [{ epoch: 2 }] : [{ vault_id: hash, scheduled: false }],
    }));
    expect(await caller().nav.request(hash)).toEqual({ vault_id: hash, scheduled: false } as never);
    expect(await caller().nav.list()).toHaveLength(1);
    expect(await caller().nav.get(hash)).toEqual({
      vault_id: hash,
      scheduled: false,
      history: [{ epoch: 2 }],
    } as never);
    reset(() => ({ data: [] }));
    expect(await caller().nav.request(hash)).toBeNull();
    expect(await caller().nav.get(hash)).toBeNull();
  });

  test("solvency.latest keeps the newest epoch per asset", async () => {
    reset(() => ({
      data: [
        { asset: "a", epoch: 3 },
        { asset: "b", epoch: 3 },
        { asset: "a", epoch: 2 },
      ],
    }));
    expect(await caller().solvency.latest()).toEqual([
      { asset: "a", epoch: 3 },
      { asset: "b", epoch: 3 },
    ] as never);
  });

  test("encumbrances: default requests are rate limited; unknown ones refused; stats count", async () => {
    reset();
    expect(await caller(null, null).encumbrances.requestDefault(upper(hash))).toEqual({
      requested: true,
    });
    expect(rpcArg(admin.log, "request_default")).toEqual({ enc: hash });
    reset(undefined, (q) =>
      q.table === "rpc:request_default" ? { error: { message: "missing" } } : undefined,
    );
    expect(await code(caller().encumbrances.requestDefault(hash))).toBe("BAD_REQUEST");
    reset(undefined, limitAll);
    expect(await code(caller().encumbrances.requestDefault(hash))).toBe("TOO_MANY_REQUESTS");
    reset(() => ({
      data: [
        { kind: "LOCKUP", released: true, enforced: false },
        { kind: "PLEDGE", released: false, enforced: true },
        { kind: "LIEN", released: false, enforced: false },
      ],
    }));
    expect(await caller().encumbrances.stats()).toEqual({
      LOCKUP: 1,
      PLEDGE: 1,
      LIEN: 1,
      released: 1,
      enforced: 1,
      active: 1,
    });
  });

  test("tree feed: leaves from an index and spent markers", async () => {
    reset((q) => ({
      data: q.table === "nullifiers" ? [{ nullifier: hash }] : [{ leaf: 5, commit: "1" }],
    }));
    expect(await caller().tree.leaves({ from: 5, limit: 10 })).toEqual([
      { leaf: 5, commit: "1" },
    ] as never);
    expect(user.log[0].arg("gte")).toEqual(["leaf", 5]);
    expect(await caller().tree.spent([upper(hash)])).toEqual([hash]);
    expect(user.log[1].arg("in")).toEqual(["nullifier", [hash]]);
    expect(await code(caller().tree.leaves({ from: 0, limit: 5001 }))).toBe("BAD_REQUEST");
  });

  test("relay: queues a call, reports refusals and status", async () => {
    reset(
      (q) => ({
        data:
          q.table === "rpc:relay_status"
            ? [{ status: "confirmed", tx_hash: hash, attempts: 1 }]
            : null,
      }),
      (q) => (q.table === "rpc:enqueue_relay" ? { data: 9 } : undefined),
    );
    expect(await caller(null, null).relay.submit({ target: ASSET, data: "0xABCD" })).toEqual({
      job: 9,
    });
    expect(rpcArg(admin.log, "enqueue_relay")).toEqual({
      target: ASSET.toLowerCase(),
      calldata: "0xabcd",
    });
    expect(await caller().relay.status(9)).toEqual({
      status: "confirmed",
      tx_hash: hash,
      attempts: 1,
    });
    reset(
      () => ({ data: [] }),
      (q) =>
        q.table === "rpc:enqueue_relay" ? { error: { message: "not allowlisted" } } : undefined,
    );
    await expect(caller().relay.submit({ target: ASSET, data: "0xabcd" })).rejects.toThrow(
      "not allowlisted",
    );
    expect(await caller().relay.status(9)).toBeNull();
    reset(undefined, limitAll);
    expect(await code(caller().relay.submit({ target: ASSET, data: "0xabcd" }))).toBe(
      "TOO_MANY_REQUESTS",
    );
    const err = quiet();
    reset(() => ({ error: { message: "x" } }));
    expect(await code(caller().relay.status(9))).toBe("INTERNAL_SERVER_ERROR");
    err.mockRestore();
  });

  test("dvp without chain access: batches read; quote, key and submit refuse", async () => {
    reset(() => ({ data: [{ seq: 1 }] }));
    expect(await caller().dvp.batches()).toEqual([{ seq: 1 }] as never);
    expect(await code(caller().dvp.quote({ assets: [ASSET] }))).toBe("PRECONDITION_FAILED");
    expect(await code(caller().dvp.key())).toBe("PRECONDITION_FAILED");
    expect(await code(caller().dvp.submit({ encryptedLegs: "box" }))).toBe("PRECONDITION_FAILED");
  });

  describe("dvp with chain access", () => {
    let restoreChain: () => void;
    beforeAll(() => {
      restoreChain = withEnv({
        RPC_URL_4663: "https://rpc.test",
        CORDON_DEPLOYMENT: JSON.stringify({
          priceOracle: "0x0000000000000000000000000000000000000002",
          chainId: 46630,
        }),
      });
      fakes.publicClient = {
        readContract: async ({ functionName }: { functionName: string }) =>
          functionName === "feeds"
            ? ["0x00000000000000000000000000000000000000fe", 3600]
            : functionName === "latestRoundData"
              ? [12n, 0n, 0n, 0n, 12n]
              : 10n ** 21n,
      };
    });
    afterAll(() => restoreChain());

    test("quote prices each distinct asset once at its latest round", async () => {
      const q = await caller().dvp.quote({ assets: [ASSET, ASSET.toLowerCase()] });
      expect(q).toEqual({
        toleranceBps: 50,
        prices: [
          {
            asset: ASSET.toLowerCase() as `0x${string}`,
            roundId: "12",
            price: (10n ** 21n).toString(),
          },
        ],
      });
    });

    test("key: the hosted sequencer's when no enclave is set, else none", async () => {
      expect(await code(caller().dvp.key())).toBe("PRECONDITION_FAILED");
      const restore = withEnv({ SEQUENCER_SEAL_SEED: `0x${"07".repeat(32)}` });
      const { sequencerKey } = await import("../sequencer");
      expect(await caller().dvp.key()).toEqual({
        publicKey: (await sequencerKey()).publicKey,
        attestation: null,
      });
      restore();
    });

    test("submit queues for the hosted sequencer, rate limited per IP", async () => {
      reset(undefined, (q) => (q.table === "rpc:dvp_enqueue" ? { data: null } : undefined));
      const r = await caller(null, null).dvp.submit({ encryptedLegs: "box" });
      expect(r.accepted).toBe(true);
      expect(r.batchEta % 60).toBe(0);
      expect(rpcArg(admin.log, "dvp_enqueue")).toEqual({ box: "box" });
      reset(undefined, limitAll);
      expect(await code(caller().dvp.submit({ encryptedLegs: "box" }))).toBe("TOO_MANY_REQUESTS");
      const err = quiet();
      reset(undefined, (q) =>
        q.table === "rpc:dvp_enqueue" ? { error: { message: "x" } } : undefined,
      );
      expect(await code(caller().dvp.submit({ encryptedLegs: "box" }))).toBe(
        "INTERNAL_SERVER_ERROR",
      );
      err.mockRestore();
    });

    test("with an enclave (SEQUENCER_URL): key and orders go to it", async () => {
      const restore = withEnv({ SEQUENCER_URL: "https://enclave.test" });
      const seen: string[] = [];
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
        url: string,
        init?: RequestInit,
      ) => {
        seen.push(`${init?.method ?? "GET"} ${url}`);
        if (String(init?.body).includes("refuse")) return new Response("no", { status: 503 });
        return Response.json(
          url.endsWith("/key")
            ? { publicKey: "pk", attestation: "att" }
            : { accepted: true, batchEta: 60 },
        );
      }) as never);
      reset();
      expect(await caller().dvp.key()).toEqual({ publicKey: "pk", attestation: "att" });
      expect(await caller().dvp.submit({ encryptedLegs: "box" })).toEqual({
        accepted: true,
        batchEta: 60,
      });
      expect(await code(caller().dvp.submit({ encryptedLegs: "refuse" }))).toBe("BAD_GATEWAY");
      expect(seen).toEqual([
        "GET https://enclave.test/key",
        "POST https://enclave.test/legs",
        "POST https://enclave.test/legs",
      ]);
      fetchSpy.mockRestore();
      restore();
    });
  });

  test("disclosures: grant, revoke (owner only) and read", async () => {
    const id = "6f1c3b6e-1c1a-4c1e-9d55-6b0f1f1f1f1f";
    reset((q) => ({
      data:
        q.op === "insert" ? { id } : q.table === "rpc:disclosure_get" ? [{ scope: "notes" }] : null,
    }));
    expect(
      await caller().disclose.grant({ viewerPk: hash, scope: "notes", ciphertext: "AA==" }),
    ).toEqual({ id });
    expect(await caller().disclose.revoke(id)).toEqual({ revoked: true });
    expect(user.log[1].arg("update")).toEqual([{ revoked: true, ciphertext: "" }]); // nothing kept after revoke
    expect(eqs(user.log[1])).toEqual([
      ["id", id],
      ["owner", "u1"],
    ]);
    expect(await caller(null, null).disclose.get(id)).toEqual({ scope: "notes" } as never);
    reset(() => ({ data: [] }));
    expect(await caller().disclose.get(id)).toBeNull();
    const err = quiet();
    reset(() => ({ error: { message: "x" } }));
    expect(
      await code(caller().disclose.grant({ viewerPk: hash, scope: "notes", ciphertext: "AA==" })),
    ).toBe("INTERNAL_SERVER_ERROR");
    expect(await code(caller().disclose.revoke(id))).toBe("INTERNAL_SERVER_ERROR");
    expect(await code(caller().disclose.get(id))).toBe("INTERNAL_SERVER_ERROR");
    err.mockRestore();
  });

  test("inbox: posts through the service role with a per-IP limit; reads after a cursor", async () => {
    reset(
      () => ({ data: [{ id: 4, box: "b" }] }),
      (q) => (q.table === "note_inbox" ? { data: { id: 3 } } : undefined),
    );
    expect(await caller(null, null).inbox.post({ box: "AA==" })).toEqual({ id: 3 });
    expect(await caller(null, null).inbox.since({ after: 3 })).toEqual([
      { id: 4, box: "b" },
    ] as never);
    expect(user.log[0].arg("gt")).toEqual(["id", 3]);
    reset(undefined, limitAll);
    expect(await code(caller().inbox.post({ box: "AA==" }))).toBe("TOO_MANY_REQUESTS");
    const err = quiet();
    reset(undefined, (q) => (q.table === "note_inbox" ? { error: { message: "x" } } : undefined));
    expect(await code(caller().inbox.post({ box: "AA==" }))).toBe("INTERNAL_SERVER_ERROR");
    err.mockRestore();
  });

  const put = (expectedVersion: number) => ({
    ciphertext: "AA==",
    iv: "AAAAAAAAAAAAAAAA",
    keyCheck: "a".repeat(64),
    expectedVersion,
  });

  test("workspace and notes blobs: read the owner's row", async () => {
    reset(() => ({
      data: { ciphertext: "AA==", iv: "iv", key_check: "k", version: 2, updated_at: "t" },
    }));
    expect(await caller().workspace.get()).toEqual({
      ciphertext: "AA==",
      iv: "iv",
      keyCheck: "k",
      version: 2,
      updatedAt: "t",
    });
    expect(user.log[0].table).toBe("workspaces");
    expect(user.log[0].arg("eq")).toEqual(["owner", "u1"]);
    await caller().notes.get();
    expect(user.log[1].table).toBe("notes_vault");
    reset(() => ({ data: null }));
    expect(await caller().workspace.get()).toBeNull();
    const err = quiet();
    reset(() => ({ error: { message: "x" } }));
    expect(await code(caller().workspace.get())).toBe("INTERNAL_SERVER_ERROR");
    err.mockRestore();
  });

  test("workspace put: version 0 creates, a later version updates, a stale version conflicts", async () => {
    reset(() => ({ data: { version: 1, updated_at: "t1" } }));
    expect(await caller().workspace.put(put(0))).toEqual({ version: 1, updatedAt: "t1" });
    expect(user.log[0].op).toBe("insert");
    expect((user.log[0].arg("insert")![0] as { owner: string }).owner).toBe("u1");
    expect(await caller().workspace.put(put(1))).toEqual({ version: 1, updatedAt: "t1" });
    expect(user.log[1].op).toBe("update");
    expect(eqs(user.log[1])).toEqual([
      ["owner", "u1"],
      ["version", 1],
    ]);
    reset(() => ({ data: null }));
    expect(await code(caller().workspace.put(put(4)))).toBe("CONFLICT");
    reset(() => ({ error: { message: "duplicate", code: "23505" } }));
    expect(await code(caller().workspace.put(put(0)))).toBe("CONFLICT");
    const err = quiet();
    reset(() => ({ error: { message: "x" } }));
    expect(await code(caller().workspace.put(put(0)))).toBe("INTERNAL_SERVER_ERROR");
    expect(await code(caller().notes.put(put(2)))).toBe("INTERNAL_SERVER_ERROR");
    err.mockRestore();
  });
});
