import { beforeAll, expect, test } from "bun:test";
import { commit, initHasher, ownerPkOf, underlying } from "@cordon/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { attest, chainClients, fetchLeaves, parseNotes, type VaultFile } from "./attest";

beforeAll(initHasher);

const STOCK = 0xaan;
const VAULT_SK = 0x5eedn;
const vaultId = `0x${"01".repeat(32)}` as `0x${string}`;
const str = (o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));

test("parseNotes turns every decimal field into a bigint", () => {
  const n = underlying(STOCK, 5n, 7n, 9n);
  expect(parseNotes({ notes: [str(n)] } as VaultFile)).toEqual([n]);
});

test("attest prices each held asset once, proves the next epoch and submits", async () => {
  const note = underlying(STOCK, 10n ** 18n, ownerPkOf(VAULT_SK), 1n);
  const file: VaultFile = {
    vaultId, totalShares: String(10n ** 18n), queueUsdg: "3", liabilities27: "0", notes: [str(note), str({ ...note, blinding: 2n })],
  };
  const reads: string[] = [];
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      reads.push(functionName);
      return ({
        feeds: ["0x00000000000000000000000000000000000000f1", 3600],
        latestRoundData: [7n, 0n, 0n, 0n, 7n],
        rawPrice: 10n ** 11n,
        vaults: ["0x01", "0x02", 4],
      } as Record<string, unknown>)[functionName];
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
  const writes: { functionName: string; args: unknown[] }[] = [];
  const wallet = { writeContract: async (w: { functionName: string; args: unknown[] }) => (writes.push(w), "0xtx") };
  const proved: string[] = [];
  const prover = {
    prove: async (name: string) => (proved.push(name), { proof: new Uint8Array([0xab]), publicInputs: Array(60).fill("0x02") }),
  };
  const out = await attest({
    client, wallet, prover, file, vaultSk: VAULT_SK, nav: "0x00000000000000000000000000000000000000Na" as never,
    oracle: "0x00000000000000000000000000000000000000Or" as never,
    leaves: async () => [commit(note), commit({ ...note, blinding: 2n })],
  } as never);

  // $100 per share x 2 notes over 1e18 shares, at 1e9 precision.
  expect(out).toEqual({ epoch: 5n, navPerShare: 2n * 10n ** 29n * 10n ** 9n / 10n ** 18n, hash: "0xtx" });
  expect(reads).toEqual(["feeds", "latestRoundData", "rawPrice", "vaults"]); // one asset, priced once
  expect(proved).toEqual(["nav"]);
  const [id, attestation, prices, proof] = writes[0].args as [string, Record<string, unknown>, { asset: string; roundId: bigint }[], string];
  expect([writes[0].functionName, id, proof]).toEqual(["attest", vaultId, "0xab"]);
  expect(attestation.epoch).toBe(5);
  expect(attestation.queueUsdg).toBe(3n);
  expect(prices).toHaveLength(16);
  expect(prices[0]).toEqual({ asset: `0x${STOCK.toString(16).padStart(40, "0")}`, roundId: 7n });
  expect(prices[1]).toEqual({ asset: "0x0000000000000000000000000000000000000000", roundId: 0n });
});

test("fetchLeaves pages the commitments feed 1000 leaves at a time", async () => {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: string) => {
    urls.push(u);
    return Response.json(Array.from({ length: urls.length === 1 ? 1000 : 2 }, (_, i) => ({ commit: String(i) })));
  }) as typeof fetch;
  try {
    expect(await fetchLeaves("https://db.invalid", "anon")).toHaveLength(1002);
    expect(urls[1]).toBe("https://db.invalid/rest/v1/commitments?select=commit&leaf=gte.1000&order=leaf&limit=1000");
  } finally {
    globalThis.fetch = real;
  }
});

test("chainClients signs with the manager key", () => {
  const key = `0x${"55".repeat(32)}` as const;
  expect(chainClients("http://127.0.0.1:9", key).wallet.account.address).toBe(privateKeyToAccount(key).address);
});
