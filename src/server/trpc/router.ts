import { assetSchema, priceOracleAbi, putWorkspaceSchema, type StoredWorkspace } from "@cordon/shared";
import { TRPCError } from "@trpc/server";
import { keccak256, toBytes } from "viem";
import { z } from "zod";

import { chainEnv } from "../chain";
import { adminDb, dbError, publicProcedure, rateLimit, router, walletProcedure } from "./trpc";

// uint256 columns are cast to text so no precision is lost on the way to JS.
const ASSET_COLUMNS =
  "asset,symbol,name,class,claim_types,templates,multiplier::text,next_mult::text,next_at,mode";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hexData = z.string().regex(/^0x([0-9a-fA-F]{2})+$/).max(200_000);

const conflict = () =>
  new TRPCError({ code: "CONFLICT", message: "Your data changed on another device." });

/** get/put for an owner-only ciphertext table (workspaces, notes_vault). */
function encryptedBlob(table: "workspaces" | "notes_vault") {
  return router({
    get: walletProcedure.query(async ({ ctx }): Promise<StoredWorkspace | null> => {
      const { data, error } = await ctx.supabase
        .from(table)
        .select("ciphertext,iv,key_check,version,updated_at")
        .eq("owner", ctx.userId)
        .maybeSingle();
      if (error) dbError(error);
      if (!data) return null;
      return {
        ciphertext: data.ciphertext,
        iv: data.iv,
        keyCheck: data.key_check,
        version: data.version,
        updatedAt: data.updated_at,
      };
    }),

    put: walletProcedure.input(putWorkspaceSchema).mutation(async ({ ctx, input }) => {
      const row = { ciphertext: input.ciphertext, iv: input.iv, key_check: input.keyCheck };

      if (input.expectedVersion === 0) {
        const { data, error } = await ctx.supabase
          .from(table)
          .insert({ ...row, owner: ctx.userId })
          .select("version,updated_at")
          .single();
        if (error?.code === "23505") throw conflict();
        if (error) dbError(error);
        return { version: data.version as number, updatedAt: data.updated_at as string };
      }

      const { data, error } = await ctx.supabase
        .from(table)
        .update(row)
        .eq("owner", ctx.userId)
        .eq("version", input.expectedVersion)
        .select("version,updated_at")
        .maybeSingle();
      if (error) dbError(error);
      if (!data) throw conflict();
      return { version: data.version as number, updatedAt: data.updated_at as string };
    }),
  });
}

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const { data, error } = await q;
  if (error) dbError(error);
  return data ?? [];
}

function chain() {
  const c = chainEnv();
  if (!c) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Chain access is not configured." });
  return c;
}

const DVP_TOLERANCE_BPS = 50; // DvPSettler.MAX_TOLERANCE_BPS

async function quoteAsset(asset: `0x${string}`) {
  const { client, deployment } = chain();
  const [feed] = await client.readContract({
    address: deployment.priceOracle,
    abi: priceOracleAbi,
    functionName: "feeds",
    args: [asset],
  });
  const round = await client.readContract({
    address: feed,
    abi: [
      {
        type: "function",
        name: "latestRoundData",
        stateMutability: "view",
        inputs: [],
        outputs: [
          { type: "uint80" },
          { type: "int256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint80" },
        ],
      },
    ] as const,
    functionName: "latestRoundData",
  });
  const roundId = round[0];
  const price = await client.readContract({
    address: deployment.priceOracle,
    abi: priceOracleAbi,
    functionName: "rawPrice",
    args: [asset, roundId],
  });
  return { asset, roundId: roundId.toString(), price: price.toString() };
}

export const appRouter = router({
  assets: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const data = await rows(ctx.supabase.from("assets").select(ASSET_COLUMNS).order("symbol"));
      return z.array(assetSchema).parse(data);
    }),
    get: publicProcedure.input(address).query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("assets")
        .select(ASSET_COLUMNS)
        .eq("asset", input.toLowerCase())
        .maybeSingle();
      if (error) dbError(error);
      return data ? assetSchema.parse(data) : null;
    }),
  }),

  income: router({
    index: publicProcedure.input(address).query(({ ctx, input }) =>
      rows(
        ctx.supabase
          .from("income_index")
          .select("ts,block,index::text,verified")
          .eq("asset", input.toLowerCase())
          .order("ts", { ascending: false })
          .limit(500),
      ),
    ),
  }),

  nav: router({
    /** Asks governance to register a vault (NavAttestor.registerVault goes through the timelock). */
    /**
     * Asks governance to register the signed-in wallet's vault. The id and the manager come
     * from the wallet, never from the request, so nobody can claim someone else's vault.
     */
    requestVault: walletProcedure
      .input(z.object({ vaultPk: bytes32 }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.wallet) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in with your wallet first." });
        await rateLimit(ctx, "vault", 10, 86400);
        await rateLimit({ ip: ctx.wallet }, "vault-wallet", 3, 86400);
        const vaultId = keccak256(toBytes(`cordon-vault:${ctx.wallet}`));
        const { error } = await adminDb().rpc("request_vault", {
          vault: vaultId.toLowerCase(),
          manager: ctx.wallet,
          pk: input.vaultPk.toLowerCase(),
        });
        if (error) dbError(error);
        return { requested: true, vaultId };
      }),
    request: publicProcedure.input(bytes32).query(async ({ ctx, input }) => {
      const [r] = await rows(ctx.supabase.from("vault_requests").select("scheduled,created_at").eq("vault_id", input.toLowerCase()));
      return r ?? null;
    }),
    list: publicProcedure.query(({ ctx }) =>
      rows(
        ctx.supabase
          .from("vaults")
          .select("vault_id,epoch,nav_per_share::text,total_shares::text,queue_usdg::text,proof_tx,ts"),
      ),
    ),
    get: publicProcedure.input(bytes32).query(async ({ ctx, input }) => {
      const [vault] = await rows(
        ctx.supabase
          .from("vaults")
          .select("vault_id,epoch,nav_per_share::text,total_shares::text,queue_usdg::text,proof_tx,ts")
          .eq("vault_id", input.toLowerCase()),
      );
      const history = await rows(
        ctx.supabase
          .from("nav_history")
          .select("epoch,ts,nav_per_share::text,ok")
          .eq("vault_id", input.toLowerCase())
          .order("epoch", { ascending: false })
          .limit(200),
      );
      return vault ? { ...vault, history } : null;
    }),
  }),

  solvency: router({
    latest: publicProcedure.query(async ({ ctx }) => {
      const all = await rows(
        ctx.supabase
          .from("solvency")
          .select("epoch,asset,ts,pool_balance::text,live_claims::text,tx")
          .order("epoch", { ascending: false })
          .limit(500),
      );
      const latest = new Map<string, (typeof all)[number]>();
      for (const r of all) if (!latest.has(r.asset)) latest.set(r.asset, r);
      return [...latest.values()];
    }),
  }),

  encumbrances: router({
    /** A holder asks for a default to be declared (testnet approves at once; see request_default). */
    requestDefault: publicProcedure.input(bytes32).mutation(async ({ ctx, input }) => {
      await rateLimit(ctx, "default", 10);
      const { error } = await adminDb().rpc("request_default", { enc: input.toLowerCase() });
      if (error) throw new TRPCError({ code: "BAD_REQUEST", message: "This encumbrance is not indexed yet." });
      return { requested: true };
    }),
    stats: publicProcedure.query(async ({ ctx }) => {
      const all = await rows(ctx.supabase.from("encumbrances").select("kind,released,enforced"));
      const stats = { LOCKUP: 0, PLEDGE: 0, LIEN: 0, released: 0, enforced: 0, active: 0 };
      for (const e of all) {
        stats[e.kind as "LOCKUP" | "PLEDGE" | "LIEN"]++;
        if (e.released) stats.released++;
        else if (e.enforced) stats.enforced++;
        else stats.active++;
      }
      return stats;
    }),
  }),

  /** Public note-tree feed for the SDK: leaves in insertion order, and spent markers. */
  tree: router({
    leaves: publicProcedure
      .input(z.object({ from: z.number().int().nonnegative(), limit: z.number().int().min(1).max(5000) }))
      .query(({ ctx, input }) =>
        rows(
          ctx.supabase
            .from("commitments")
            .select("leaf,commit")
            .gte("leaf", input.from)
            .order("leaf")
            .limit(input.limit),
        ),
      ),
    spent: publicProcedure.input(z.array(bytes32).max(500)).query(async ({ ctx, input }) => {
      const found = await rows(
        ctx.supabase
          .from("nullifiers")
          .select("nullifier")
          .in(
            "nullifier",
            input.map((n) => n.toLowerCase()),
          ),
      );
      return found.map((r) => r.nullifier as string);
    }),
  }),

  relay: router({
    /** Queues a proof-carrying call to an allowlisted engine function; no auth needed. */
    submit: publicProcedure
      .input(z.object({ target: address, data: hexData }))
      .mutation(async ({ ctx, input }) => {
        await rateLimit(ctx, "relay", 60);
        const { data, error } = await adminDb().rpc("enqueue_relay", {
          target: input.target.toLowerCase(),
          calldata: input.data.toLowerCase(),
        });
        if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        return { job: data as number };
      }),
    status: publicProcedure.input(z.number().int().positive()).query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase.rpc("relay_status", { job_id: input });
      if (error) dbError(error);
      return (data as { status: string; tx_hash: string | null; attempts: number }[])[0] ?? null;
    }),
  }),

  dvp: router({
    batches: publicProcedure.query(({ ctx }) =>
      rows(
        ctx.supabase
          .from("dvp_batches")
          .select("seq,ts,n_trades,n_legs,prices_hash,tx")
          .order("ts", { ascending: false })
          .limit(100),
      ),
    ),
    /** Reference prices (per raw unit, 1e27 = $1) at the latest round, plus tolerance. */
    quote: publicProcedure
      .input(z.object({ assets: z.array(address).min(1).max(16) }))
      .query(async ({ input }) => ({
        toleranceBps: DVP_TOLERANCE_BPS,
        prices: await Promise.all(
          [...new Set(input.assets.map((a) => a.toLowerCase() as `0x${string}`))].map(quoteAsset),
        ),
      })),
    /** The key orders are sealed to: the enclave's (SEQUENCER_URL), else the hosted testnet sequencer's. */
    key: publicProcedure.query(async () => {
      const url = chain().sequencerUrl;
      if (url) return (await (await fetch(`${url}/key`)).json()) as { publicKey: string; attestation: string | null };
      if (!process.env.SEQUENCER_SEAL_SEED) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No sequencer configured." });
      const { sequencerKey } = await import("../sequencer");
      return { publicKey: (await sequencerKey()).publicKey, attestation: null };
    }),
    /** Sealed orders go to the enclave, or wait in dvp_orders for the hosted sequencer; never decrypted here. */
    submit: publicProcedure
      .input(z.object({ encryptedLegs: z.string().max(200_000) }))
      .mutation(async ({ ctx, input }) => {
        const url = chain().sequencerUrl;
        await rateLimit(ctx, "dvp", 30);
        if (!url) {
          const { error } = await adminDb().rpc("dvp_enqueue", { box: input.encryptedLegs });
          if (error) dbError(error);
          return { accepted: true, batchEta: Math.ceil(Date.now() / 60_000) * 60 };
        }
        const res = await fetch(`${url}/legs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ encryptedLegs: input.encryptedLegs }),
        });
        if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `sequencer ${res.status}` });
        return (await res.json()) as { accepted: boolean; batchEta: number };
      }),
  }),

  disclose: router({
    grant: walletProcedure
      .input(
        z.object({
          viewerPk: z.string().regex(/^0x[0-9a-f]{64,130}$/),
          scope: z.string().regex(/^[a-z][a-z0-9_:.-]{0,63}$/),
          ciphertext: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(200_000),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { data, error } = await ctx.supabase
          .from("disclosures")
          .insert({ viewer_pk: input.viewerPk, scope: input.scope, ciphertext: input.ciphertext })
          .select("id")
          .single();
        if (error) dbError(error);
        return { id: data.id as string };
      }),
    revoke: walletProcedure.input(z.string().uuid()).mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("disclosures")
        .update({ revoked: true })
        .eq("id", input)
        .eq("owner", ctx.userId);
      if (error) dbError(error);
      return { revoked: true };
    }),
    get: publicProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase.rpc("disclosure_get", { grant_id: input });
      if (error) dbError(error);
      return (data as { scope: string; viewer_pk: string; ciphertext: string }[])[0] ?? null;
    }),
  }),

  /** Sealed notes between wallets; recipients try every box, so nothing names them. */
  inbox: router({
    post: publicProcedure
      .input(z.object({ box: z.string().max(12_000).regex(/^[A-Za-z0-9+/=.]+$/) }))
      .mutation(async ({ ctx, input }) => {
        await rateLimit(ctx, "inbox", 120);
        const { data, error } = await adminDb().from("note_inbox").insert({ box: input.box }).select("id").single();
        if (error) dbError(error);
        return { id: data.id as number };
      }),
    since: publicProcedure
      .input(z.object({ after: z.number().int().nonnegative() }))
      .query(({ ctx, input }) =>
        rows(ctx.supabase.from("note_inbox").select("id,box").gt("id", input.after).order("id").limit(1000)),
      ),
  }),

  workspace: encryptedBlob("workspaces"),
  notes: encryptedBlob("notes_vault"),
});

export type AppRouter = typeof appRouter;
