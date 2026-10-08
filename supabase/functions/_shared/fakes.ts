// Test doubles for the workers: a recording Supabase client, a captured Deno.serve and
// ABI-encoded logs. Every *_test.ts imports this module FIRST: workers call
// serveWorker (Deno.serve) at import, and ES modules evaluate in import order.
import { encodeAbiParameters, encodeEventTopics, type Abi, type AbiEvent, type Hex, type Log } from "npm:viem@2.56.9";

type Handler = (req: Request) => Response | Promise<Response>;

/** Handlers the workers passed to Deno.serve; tests call them instead of serving. */
export const served: Handler[] = [];
Deno.serve = ((h: Handler) => {
  served.push(h);
  return {};
}) as unknown as typeof Deno.serve;

/** One recorded Supabase call: the table (or `rpc:<name>`) and the builder methods applied to it. */
export type Call = { table: string; ops: [string, unknown[]][] };

/** Answers a recorded call; returning undefined means `{ data: null, error: null }`. */
export type Respond = (c: Call) => { data?: unknown; error?: unknown } | undefined;

/**
 * A Supabase client double. Every `from(table)` chain is recorded in `calls` and,
 * when awaited, resolves to whatever `respond` returns for it.
 */
export function fakeDb(respond: Respond = () => undefined) {
  const calls: Call[] = [];
  const answer = (c: Call) => Promise.resolve({ data: null, error: null, ...respond(c) });
  const builder = (c: Call): unknown =>
    new Proxy({}, {
      get: (_, k) => {
        if (k === "then") return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => answer(c).then(ok, fail);
        if (typeof k !== "string") return undefined;
        return (...args: unknown[]) => {
          c.ops.push([k, args]);
          return builder(c);
        };
      },
    });
  const db = {
    calls,
    from(table: string) {
      const c: Call = { table, ops: [] };
      calls.push(c);
      return builder(c);
    },
    rpc(name: string, args: unknown) {
      const c: Call = { table: `rpc:${name}`, ops: [["args", [args]]] };
      calls.push(c);
      return answer(c);
    },
    /** The calls made on one table (or `rpc:<name>`). */
    on: (table: string) => calls.filter((c) => c.table === table),
  };
  return db;
}

/** The first argument of builder method `op` in a call, if it was applied. */
export const arg = (c: Call, op: string): any => c.ops.find(([k]) => k === op)?.[1][0];

/** Whether a call applied builder method `op`. */
export const has = (c: Call, op: string) => c.ops.some(([k]) => k === op);

/** An encoded log of `eventName` from `abi`, as `getLogs` returns it. */
export function mkLog(abi: Abi, eventName: string, args: Record<string, unknown>, blockNumber = 7n): Log {
  const ev = abi.find((x) => x.type === "event" && x.name === eventName) as AbiEvent;
  const indexed = Object.fromEntries(ev.inputs.filter((i) => i.indexed).map((i) => [i.name!, args[i.name!]]));
  const plain = ev.inputs.filter((i) => !i.indexed);
  return {
    address: "0x00000000000000000000000000000000000000aa",
    blockHash: `0x${"bb".repeat(32)}`,
    blockNumber,
    data: encodeAbiParameters(plain, plain.map((i) => args[i.name!])),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({ abi: [ev], eventName, args: indexed } as never) as [Hex, ...Hex[]],
    transactionHash: `0x${"cc".repeat(32)}`,
    transactionIndex: 0,
  };
}

/** A worker answer as JSON. */
export const body = async (r: Response | Promise<Response>) => {
  const res = await r;
  return { status: res.status, json: await res.json() };
};

/** Unsets the worker secrets so a served handler fails fast instead of reaching a network. */
export function clearSecrets() {
  for (const k of [
    "CORDON_DEPLOYMENT", "RPC_URL_4663", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "RELAYER_PRIVATE_KEY", "KEEPER_PRIVATE_KEY",
  ]) Deno.env.delete(k);
}

// Minimal assertions: node:assert and @std/assert would add packages to deno.lock.
const show = (x: unknown) => Deno.inspect(x, { depth: Infinity, sorted: true, colors: false, iterableLimit: Infinity });

/** Throws unless `actual` and `expected` print the same (deep, key-order independent). */
export function eq(actual: unknown, expected: unknown, msg = "not equal") {
  if (show(actual) !== show(expected)) throw new Error(`${msg}\n  actual:   ${show(actual)}\n  expected: ${show(expected)}`);
}

/** Throws unless `cond` is truthy. */
export function ok(cond: unknown, msg = "expected truthy") {
  if (!cond) throw new Error(msg);
}

/** Throws unless `fn` throws (or rejects) with a message matching `re`. */
export async function throws(fn: () => unknown, re: RegExp) {
  try {
    await fn();
  } catch (e) {
    if (!re.test(String(e instanceof Error ? e.message : e) + " " + JSON.stringify(e))) throw new Error(`threw ${e}, expected ${re}`);
    return;
  }
  throw new Error(`did not throw ${re}`);
}

/** Calls a served worker handler with the secrets unset and console.error muted. */
export async function callServed(h: Handler) {
  clearSecrets();
  const error = console.error;
  console.error = () => {};
  try {
    return await body(h(new Request("http://x")));
  } finally {
    console.error = error;
  }
}
