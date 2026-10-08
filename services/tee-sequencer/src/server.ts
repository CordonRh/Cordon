/**
 * DvP sequencer (spec §4). Runs inside an AWS Nitro Enclave; see docs/ARCHITECTURE.md.
 *
 *   GET  /key   -> { publicKey, attestation }   clients seal orders to publicKey
 *   POST /legs  -> { accepted, batchEta }       body { encryptedLegs } (sdk `seal`)
 *
 * Every BATCH_SECONDS it pins one price per asset (latest Chainlink round through
 * PriceOracle), pairs orders, proves each trade and calls DvPSettler.submitBatch.
 * Stale oracle -> nothing is submitted and orders carry. Orders carry their traders'
 * order proofs, never spending keys; the enclave keeps the orders' contents private.
 * Traders rebuild their new notes from the TradeSettled event (amounts are published
 * masked by their own order salt), so nothing has to be delivered from here.
 */
import {
  authorised,
  wellFormed,
  commit,
  fetchCircuits,
  generateSealKey,
  initHasher,
  needsOracle,
  NoteTree,
  open,
  orderPublicInputs,
  pair,
  Prover,
  toHex,
  tradeArgs,
  tradeInputs,
  wipe,
  type Order,
} from "@cordon/sdk";
import { dvpSettlerAbi, priceOracleAbi, robinhoodChain } from "@cordon/shared";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createPublicClient, createWalletClient, hexToBytes, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const MAX_BODY = 200_000; // one sealed order
const MAX_PENDING = 2_000;

/** The chain clients the sequencer reads prices with and submits batches from. */
export const chainClients = (rpc: string, key: Hex) => {
  const chain = robinhoodChain(rpc, Number(process.env.CHAIN_ID ?? 4663));
  return {
    client: createPublicClient({ chain, transport: http(rpc) }),
    wallet: createWalletClient({ chain, account: privateKeyToAccount(key), transport: http(rpc) }),
  };
};

/** Everything the sequencer touches outside its own memory; tests pass fakes. */
export type Deps = ReturnType<typeof chainClients> & {
  prover: Pick<Prover, "prove" | "verify">;
  sealKey: { publicKey: string; privateKey: CryptoKey };
  /** Enclave attestation document for the seal key, served with it. */
  attestation: string | null;
  oracle: Address;
  settler: Address;
  /** The current note tree (the public commitments feed). */
  loadTree: () => Promise<NoteTree>;
  batchSeconds: number;
  toleranceBps: bigint;
};

/** Loads the note tree from the Supabase commitments feed, 1000 leaves per page. */
export async function loadTree(supabase: string, anon: string) {
  const leaves: bigint[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${supabase}/rest/v1/commitments?select=commit&leaf=gte.${from}&order=leaf&limit=1000`, {
      headers: { apikey: anon },
    });
    const page = (await res.json()) as { commit: string }[];
    leaves.push(...page.map((r) => BigInt(r.commit)));
    if (page.length < 1000) return new NoteTree(leaves);
  }
}

const feedAbi = [
  {
    type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
  {
    type: "function", name: "getRoundData", stateMutability: "view", inputs: [{ type: "uint80" }],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
] as const;

const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

/**
 * The sequencer: `handle` serves GET /key and POST /legs (sealed orders into the
 * pending book), `batch` pairs, proves and submits one DvP batch.
 */
export function sequencer({
  client, wallet, prover, sealKey, attestation, oracle, settler, loadTree, batchSeconds, toleranceBps,
}: Deps) {
  let pending: Order[] = [];
  let nextBatch = Date.now() + batchSeconds * 1000;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === "GET" && req.url === "/key") return json(res, 200, { publicKey: sealKey.publicKey, attestation });
    if (req.method !== "POST" || req.url !== "/legs") return json(res, 404, { error: "not found" });
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        // Answer before leaving the loop: under Bun, throwing out of `for await (req)`
        // loses the response and the client sees an empty 200.
        if (body.length > MAX_BODY) return json(res, 400, { accepted: false, batchEta: 0 });
      }
      if (pending.length >= MAX_PENDING) throw new Error("order book full");
      const { encryptedLegs } = JSON.parse(body) as { encryptedLegs: string };
      const order = await open<Order>(sealKey.privateKey, encryptedLegs);
      const nowS = Date.now() / 1000;
      if (!wellFormed(order) || order.expiresAt < nowS || order.expiresAt > nowS + 3600 || !authorised(order)) {
        throw new Error("bad order");
      }
      const proof = { proof: hexToBytes(order.auth.proof), publicInputs: orderPublicInputs(order.auth) };
      if (!(await prover.verify("order", proof))) throw new Error("bad order proof");
      // One open order per note: a newer order over the same note replaces the older one.
      const mine = new Set(order.auth.nullifiers.filter((n) => n !== 0n));
      pending = pending.filter((o) => !o.auth.nullifiers.some((n) => mine.has(n)));
      pending.push(order);
      json(res, 200, { accepted: true, batchEta: Math.ceil(nextBatch / 1000) });
    } catch {
      json(res, 400, { accepted: false, batchEta: 0 });
    }
  }

  async function batch() {
    nextBatch = Date.now() + batchSeconds * 1000;
    const now = Math.floor(Date.now() / 1000);
    pending = pending.filter((o) => o.expiresAt > now);
    if (pending.length < 2) return;

    // Pin one round per underlying asset for the whole batch.
    const rounds = new Map<bigint, { roundId: bigint; price: bigint }>();
    for (const o of pending) {
      for (const g of o.gives) {
        if (!needsOracle(g.note.kind) || rounds.has(g.note.asset)) continue;
        const asset = `0x${g.note.asset.toString(16).padStart(40, "0")}` as Address;
        const [feed] = await client.readContract({ address: oracle, abi: priceOracleAbi, functionName: "feeds", args: [asset] });
        // The round in force at the batch time (what the settler checks), not the newest.
        const batchTime = BigInt(now) - 30n;
        let [roundId, , , updatedAt] = await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
        for (let back = 0; updatedAt > batchTime && back < 10 && roundId > 1n; back++) {
          [roundId, , , updatedAt] = await client.readContract({ address: feed, abi: feedAbi, functionName: "getRoundData", args: [roundId - 1n] });
        }
        const price = await client
          .readContract({ address: oracle, abi: priceOracleAbi, functionName: "rawPriceAt", args: [asset, roundId, batchTime] })
          .catch(() => undefined); // stale -> this asset's orders wait
        if (price !== undefined) rounds.set(g.note.asset, { roundId, price });
      }
    }
    const price = (asset: bigint, kind: bigint, quote27?: bigint) =>
      needsOracle(kind) ? rounds.get(asset)?.price : quote27;

    // Only orders whose notes are in the tree pair, so an order over a note that never
    // existed cannot keep claiming a real counterparty; the others wait until they expire.
    const t = await loadTree();
    const inTree = (o: Order) => o.gives.every((g) => t.indexOf(commit(g.note)) >= 0);
    const { trades, prices: table, rest } = pair(pending.filter(inTree), price, toleranceBps);
    rest.push(...pending.filter((o) => !inTree(o)));
    if (trades.length === 0) return;

    const proven = [];
    for (const tr of trades) {
      // A pair that cannot be proven is dropped; the rest of the batch goes on.
      try {
        const p = await prover.prove("dvp", tradeInputs(tr, table, t, BigInt(now) - 30n, toleranceBps));
        proven.push({ tr, args: tradeArgs(toHex(p.proof), p.publicInputs, toleranceBps, [tr.a.auth, tr.b.auth]) });
      } catch (err) {
        console.error("trade not provable", err);
      }
    }
    if (proven.length === 0) {
      pending = rest;
      return;
    }

    const zero = "0x0000000000000000000000000000000000000000" as Address;
    const prices = Array.from({ length: 16 }, (_, i) => {
      const p = table[i];
      if (!p) return { asset: zero, kind: 0, roundId: 0n, quote: 0n };
      const oracleLeg = needsOracle(p.kind);
      return {
        asset: `0x${p.asset.toString(16).padStart(40, "0")}` as Address,
        kind: Number(p.kind),
        roundId: oracleLeg ? rounds.get(p.asset)!.roundId : 0n,
        quote: oracleLeg ? 0n : p.price,
      };
    });

    const hash = await wallet.writeContract({
      address: settler,
      abi: dvpSettlerAbi,
      functionName: "submitBatch",
      args: [BigInt(now) - 30n, prices as never, proven.map((x) => x.args) as never],
    });
    await client.waitForTransactionReceipt({ hash });
    wipe(proven.flatMap(({ tr }) => [tr.a, tr.b]));
    pending = rest;
  }

  return { handle, batch, pending: () => pending };
}

if (import.meta.main) {
  const BATCH_SECONDS = Number(process.env.BATCH_SECONDS ?? 60);
  const PORT = Number(process.env.PORT ?? 8080);
  const rpc = env("RPC_URL_4663");
  const clients = chainClients(rpc, env("SEQUENCER_PRIVATE_KEY") as Hex);
  const oracle = env("PRICE_ORACLE") as Address;
  const settler = env("DVP_SETTLER") as Address;
  const supabase = env("SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY");
  const circuitsDir = process.env.CIRCUITS_DIR;

  await initHasher();
  const s = sequencer({
    ...clients,
    sealKey: await generateSealKey(), // generated in the enclave, never leaves it
    prover: new Prover(
      circuitsDir ? async (n) => JSON.parse(await readFile(join(circuitsDir, `${n}.json`), "utf8")) : fetchCircuits(),
    ),
    // Note: attestation is left to the enclave runtime (NSM document fetched by the
    // parent's vsock proxy); clients must check it before trusting publicKey.
    attestation: process.env.ATTESTATION_DOC ?? null,
    oracle,
    settler,
    loadTree: () => loadTree(supabase, anon),
    batchSeconds: BATCH_SECONDS,
    toleranceBps: BigInt(process.env.TOLERANCE_BPS ?? 25),
  });
  createServer(s.handle).listen(PORT);
  setInterval(() => void s.batch().catch((e) => console.error("batch failed", e)), BATCH_SECONDS * 1000);
  console.log(`sequencer on :${PORT}, batches every ${BATCH_SECONDS}s`);
}
