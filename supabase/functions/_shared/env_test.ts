import { body, clearSecrets, eq, ok, served, throws } from "./fakes.ts";
import { chain, db, deployment, hex32, keeperClient, lower, publicClient, serveWorker, walletClient } from "./env.ts";

Deno.test("hex32 pads a uint256 and lower lower-cases", () => {
  eq(hex32(255n), `0x${"0".repeat(62)}ff`);
  eq(lower("0xAbC"), "0xabc");
});

Deno.test("deployment reads CORDON_DEPLOYMENT and fails closed without it", async () => {
  clearSecrets();
  await throws(() => deployment(), /missing secret CORDON_DEPLOYMENT/);
  Deno.env.set("CORDON_DEPLOYMENT", JSON.stringify({ chainId: 46630, pool: "0x01" }));
  eq(deployment().pool, "0x01");
  clearSecrets();
});

Deno.test("clients come from their own secrets, keeper and relayer keys stay apart", async () => {
  clearSecrets();
  await throws(() => publicClient(), /missing secret RPC_URL_4663/);
  Deno.env.set("RPC_URL_4663", "http://127.0.0.1:9");
  await throws(() => walletClient(), /missing secret RELAYER_PRIVATE_KEY/);
  await throws(() => keeperClient(), /missing secret KEEPER_PRIVATE_KEY/);
  Deno.env.set("RELAYER_PRIVATE_KEY", `0x${"11".repeat(32)}`);
  Deno.env.set("KEEPER_PRIVATE_KEY", `0x${"22".repeat(32)}`);
  eq(publicClient().chain.id, chain.id);
  ok(walletClient().account.address !== keeperClient().account.address);
  await throws(() => db(), /missing secret SUPABASE_URL/);
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
  eq(typeof db().from, "function");
  clearSecrets();
});

Deno.test("serveWorker answers ok with the result, or 500 with the error", async () => {
  const quiet = console.error;
  console.error = () => {};
  serveWorker(() => Promise.resolve({ n: 1 }));
  serveWorker(() => Promise.reject(new Error("boom")));
  const [ok, bad] = served.slice(-2);
  eq(await body(ok(new Request("http://x"))), { status: 200, json: { ok: true, result: { n: 1 } } });
  eq(await body(bad(new Request("http://x"))), { status: 500, json: { ok: false, error: "Error: boom" } });
  console.error = quiet;
});
