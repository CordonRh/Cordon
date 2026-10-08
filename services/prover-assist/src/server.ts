/**
 * prover-assist (spec §4): GPU/server-side UltraHonk proving for clients that cannot
 * prove fast enough themselves (target p95 < 10s on mobile).
 *
 *   POST /prove  { circuit, inputs }  -> { proof, publicInputs }
 *   header x-cordon-token: PROVER_TOKEN
 *
 * Note: witnesses carry spending keys, so this runs only inside the same
 * Nitro enclave boundary as the sequencer (or on a vault manager's own host);
 * witness blinding for an untrusted GPU fleet is future work.
 */
import { fetchCircuits, Prover, toHex, type CircuitName } from "@cordon/sdk";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

const TOKEN = process.env.PROVER_TOKEN ?? "";
/** Circuits this service proves; anything else is refused before proving. */
export const CIRCUITS: CircuitName[] = ["transfer", "bundle", "unbundle", "term", "income", "dvp", "encumber", "unlock", "enforce", "nav"];

/** Constant-time token check; an unset expected token admits nobody. */
export const authorized = (token: string | undefined, expected = TOKEN) =>
  !!expected && !!token && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));

/** The POST /prove handler around `prover`, gated by the `x-cordon-token` header. */
export const handler = (prover: Pick<Prover, "prove">, token = TOKEN) => async (req: IncomingMessage, res: ServerResponse) => {
  const reply = (status: number, body: unknown) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (req.method !== "POST" || req.url !== "/prove") return reply(404, { error: "not found" });
  if (!authorized(req.headers["x-cordon-token"] as string | undefined, token)) return reply(401, { error: "unauthorized" });
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { circuit, inputs } = JSON.parse(body);
    if (!CIRCUITS.includes(circuit)) return reply(400, { error: "unknown circuit" });
    const started = Date.now();
    const p = await prover.prove(circuit, inputs);
    reply(200, { proof: toHex(p.proof), publicInputs: p.publicInputs, ms: Date.now() - started });
  } catch (e) {
    reply(422, { error: String(e).slice(0, 300) });
  }
};

if (import.meta.main) {
  const dir = process.env.CIRCUITS_DIR;
  const prover = new Prover(dir ? async (n) => JSON.parse(await readFile(join(dir, `${n}.json`), "utf8")) : fetchCircuits());
  createServer(handler(prover)).listen(Number(process.env.PORT ?? 8081));
}
