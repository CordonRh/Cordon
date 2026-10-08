/// <reference types="node" />
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { initTRPC, TRPCError } from "@trpc/server";

export interface Context {
  /** Supabase client acting as the caller: anon, or the signed-in wallet via its JWT (RLS applies). */
  supabase: SupabaseClient | null;
  userId: string | null;
  /** The signed-in wallet (Supabase web3 sign-in), lower case. */
  wallet: string | null;
  /** Client IP as the platform reports it, for rate limits. */
  ip: string;
}

function serverEnv() {
  const e = process.env;
  const url = e.SUPABASE_URL ?? e.VITE_SUPABASE_URL;
  const key = e.SUPABASE_ANON_KEY ?? e.VITE_SUPABASE_ANON_KEY ?? e.VITE_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/** Request context: a caller-scoped Supabase client, the signed-in wallet and the client IP. */
export async function createContext(req: Request): Promise<Context> {
  const cfg = serverEnv();
  const ip = clientIp(req);
  if (!cfg) return { supabase: null, userId: null, wallet: null, ip };

  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  const supabase = createClient(cfg.url, cfg.key, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!token) return { supabase, userId: null, wallet: null, ip };

  const { data } = await supabase.auth.getUser(token);
  // The wallet comes from the web3 identity the auth server wrote at sign-in
  // (provider_id = "web3:ethereum:0x..."), never from user_metadata, which users can edit.
  const ident = data.user?.identities?.find((i) => i.provider === "web3");
  const m = String(ident?.identity_data?.sub ?? ident?.id ?? "").match(/^web3:ethereum:(0x[0-9a-fA-F]{40})$/);
  const wallet = m ? m[1].toLowerCase() : null;
  return { supabase, userId: data.user?.id ?? null, wallet, ip };
}

let admin: SupabaseClient | undefined;
/** Service-role client for the writes anon may not make directly (rate-limited queues). */
export function adminDb(): SupabaseClient {
  const e = process.env;
  const url = e.SUPABASE_URL ?? e.VITE_SUPABASE_URL;
  if (!url || !e.SUPABASE_SERVICE_ROLE_KEY) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The Cordon backend is not configured." });
  }
  admin ??= createClient(url, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/**
 * Client address for rate limits: Vercel's own x-vercel-forwarded-for (clients cannot set
 * it), else "unknown". IPv6 clients are keyed by their /64, which one client controls;
 * every spelling of one /64 (zero runs, leading zeros, case) maps to the same key.
 */
export function clientIp(req: Request) {
  const raw = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim().toLowerCase();
  if (!raw) return "unknown";
  if (!raw.includes(":")) return raw;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(raw); // IPv4-mapped (::ffff:a.b.c.d)
  if (v4) return v4[1];
  const [head, tail] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":")}::/64`;
}

/**
 * Fixed-window limit per key (a client IP, or a wallet). No global ceilings: a shared
 * bucket is a lever anyone can pull to lock everyone out; storage is bounded by the box
 * size caps and pruning instead.
 */
export async function rateLimit(ctx: { ip: string }, name: string, max: number, windowSeconds = 3600) {
  const { data, error } = await adminDb().rpc("rate_take", { key: `${name}:${ctx.ip}`, max_count: max, window_seconds: windowSeconds });
  if (error) dbError(error);
  if (data !== true) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests; try again later." });
}

// Stack traces only in local development, never in deployed responses.
const t = initTRPC.context<Context>().create({ isDev: process.env.NODE_ENV === "development" });

export const router = t.router;

export const publicProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.supabase) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The Cordon backend is not configured.",
    });
  }
  return next({ ctx: { ...ctx, supabase: ctx.supabase } });
});

export const walletProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in with your wallet first." });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

/** Logs a database error and returns a generic one to the caller. */
export function dbError(error: { message: string } | null): never {
  console.error(error);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The request could not be completed.",
  });
}
