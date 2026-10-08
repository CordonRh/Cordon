import { describe, expect, test } from "bun:test";

import { fakeDb, fakes, withEnv } from "../fakes";
import { handleTrpc } from "./handler";
import { clientIp, createContext } from "./trpc";

const ip = (v?: string) =>
  clientIp(new Request("https://x", { headers: v ? { "x-vercel-forwarded-for": v } : {} }));

test("rate-limit keys: every spelling of one IPv6 /64 is one bucket", () => {
  const key = "2001:db8:0:1::/64";
  expect(ip("2001:db8::1:0:0:0:1")).toBe(key);
  expect(ip("2001:0DB8:0000:0001:ffff::9")).toBe(key);
  expect(ip("2001:db8:0:1:a:b:c:d")).toBe(key);
  expect(ip("2001:db8:0:2::1")).not.toBe(key);
  expect(ip("::ffff:203.0.113.7")).toBe("203.0.113.7");
  expect(ip("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
  expect(ip()).toBe("unknown");
});

const noBackend = {
  SUPABASE_URL: undefined,
  VITE_SUPABASE_URL: undefined,
  SUPABASE_ANON_KEY: undefined,
  VITE_SUPABASE_ANON_KEY: undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
};
const req = (token?: string) =>
  new Request("https://x/api/trpc/assets.list", {
    headers: {
      "x-vercel-forwarded-for": "198.51.100.4",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

describe("createContext", () => {
  test("without a backend there is no client, but the IP is still known", async () => {
    const restore = withEnv(noBackend);
    expect(await createContext(req("t"))).toEqual({
      supabase: null,
      userId: null,
      wallet: null,
      ip: "198.51.100.4",
    });
    restore();
  });

  describe("with a backend", () => {
    const run = async (token: string | undefined, user: unknown) => {
      const restore = withEnv({
        ...noBackend,
        SUPABASE_URL: "https://db.test",
        SUPABASE_ANON_KEY: "anon",
      });
      const seen: unknown[] = [];
      const db = fakeDb(undefined, user);
      fakes.supabase = (url, key, opts) => {
        seen.push({ url, key, headers: (opts as { global: { headers: unknown } }).global.headers });
        return db.client;
      };
      try {
        return { ctx: await createContext(req(token)), seen };
      } finally {
        fakes.supabase = null;
        restore();
      }
    };

    test("an anonymous caller gets an anon client", async () => {
      const { ctx, seen } = await run(undefined, null);
      expect(ctx).toMatchObject({ userId: null, wallet: null, ip: "198.51.100.4" });
      expect(ctx.supabase).not.toBeNull();
      expect(seen).toEqual([{ url: "https://db.test", key: "anon", headers: {} }]);
    });

    test("the wallet comes from the web3 identity, lower-cased, and the JWT is forwarded", async () => {
      const wallet = "0x00000000000000000000000000000000000000Ab";
      const { ctx, seen } = await run("jwt", {
        id: "u1",
        user_metadata: { wallet: "0x00000000000000000000000000000000000000ff" },
        identities: [
          { provider: "email", id: "x" },
          { provider: "web3", identity_data: { sub: `web3:ethereum:${wallet}` } },
        ],
      });
      expect(ctx).toMatchObject({ userId: "u1", wallet: wallet.toLowerCase() });
      expect(seen).toEqual([
        { url: "https://db.test", key: "anon", headers: { Authorization: "Bearer jwt" } },
      ]);
    });

    test("a web3 identity id is a fallback; anything else is no wallet", async () => {
      const wallet = "0x00000000000000000000000000000000000000cd";
      expect(
        (
          await run("jwt", {
            id: "u2",
            identities: [{ provider: "web3", id: `web3:ethereum:${wallet}` }],
          })
        ).ctx.wallet,
      ).toBe(wallet);
      expect(
        (await run("jwt", { id: "u3", identities: [{ provider: "web3", id: "web3:solana:abc" }] }))
          .ctx,
      ).toMatchObject({ userId: "u3", wallet: null });
      expect(
        (await run("jwt", { id: "u4", user_metadata: { sub: `web3:ethereum:${wallet}` } })).ctx
          .wallet,
      ).toBeNull();
      expect((await run("bad", null)).ctx).toMatchObject({ userId: null, wallet: null });
    });
  });
});

test("handleTrpc serves /api/trpc and refuses when the backend is not configured", async () => {
  const restore = withEnv(noBackend);
  const res = await handleTrpc(req());
  restore();
  expect(res.status).toBe(412);
  expect(JSON.stringify(await res.json())).toContain("not configured");
});
