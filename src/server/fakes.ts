/// <reference types="bun" />
/**
 * Test doubles for the server code (imported by *.test.ts only, never by the app).
 * Supabase's createClient and viem's client factories are swapped for switchable
 * fakes: while a switch is null the real factory runs, so other test files that
 * share the process see the real modules.
 */
import { mock } from "bun:test";
import * as supabaseJs from "@supabase/supabase-js";
import * as viem from "viem";

const realCreateClient = supabaseJs.createClient;
const realPublicClient = viem.createPublicClient;
const realWalletClient = viem.createWalletClient;

/** Switches for the mocked factories; null means "use the real one". */
export const fakes = {
  supabase: null as null | ((url: string, key: string, opts?: unknown) => unknown),
  publicClient: null as unknown,
  walletClient: null as unknown,
};

mock.module("@supabase/supabase-js", () => ({
  ...supabaseJs,
  createClient: (...a: Parameters<typeof realCreateClient>) =>
    fakes.supabase ? fakes.supabase(a[0], a[1], a[2]) : realCreateClient(...a),
}));
mock.module("viem", () => ({
  ...viem,
  createPublicClient: (...a: Parameters<typeof realPublicClient>) =>
    fakes.publicClient ?? realPublicClient(...a),
  createWalletClient: (...a: Parameters<typeof realWalletClient>) =>
    fakes.walletClient ?? realWalletClient(...a),
}));

/** One query a fake database saw: the table (or `rpc:<name>`), its first verb and every call. */
export type Query = {
  table: string;
  op: string;
  calls: [string, unknown[]][];
  arg: (name: string) => unknown[] | undefined;
};
/** What a fake database answers to a query. */
export type Reply =
  { data?: unknown; error?: { message: string; code?: string } | null } | undefined;

const VERBS = new Set(["select", "insert", "update", "upsert", "delete"]);

/**
 * A chainable, awaitable stand-in for a SupabaseClient. Every query is logged and
 * answered by `answer` when awaited; `user` is what auth.getUser returns.
 */
export function fakeDb(answer: (q: Query) => Reply = () => undefined, user: unknown = null) {
  const log: Query[] = [];
  const query = (table: string, op = "", first?: unknown[]): unknown => {
    const q: Query = {
      table,
      op,
      calls: first ? [[op, first]] : [],
      arg: (name) => q.calls.find(([n]) => n === name)?.[1],
    };
    log.push(q);
    const builder: unknown = new Proxy(
      {},
      {
        get(_, k: string) {
          if (k === "then")
            return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null, ...answer(q) }).then(ok, fail);
          return (...args: unknown[]) => {
            if (!q.op && VERBS.has(k)) q.op = k;
            q.calls.push([k, args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const client = {
    from: (table: string) => query(table),
    rpc: (name: string, args?: unknown) => query(`rpc:${name}`, "rpc", [args]),
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  };
  return { log, client: client as unknown as supabaseJs.SupabaseClient };
}

/** Sets environment variables for one test file and returns a function that restores them. */
export function withEnv(vars: Record<string, string | undefined>) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) delete process.env[k];
      else process.env[k] = x;
    }
  };
  apply(vars);
  return () => apply(before);
}
