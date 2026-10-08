import { afterAll, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { authorized, handler } from "./server";

const TOKEN = "s3cret-token";
const proved: string[] = [];
const prover = {
  prove: async (circuit: string, inputs: { fail?: boolean }) => {
    if (inputs.fail) throw new Error("witness unsatisfied");
    proved.push(circuit);
    return { proof: new Uint8Array([1, 2]), publicInputs: ["0x01"] };
  },
};
const server = createServer(handler(prover as never, TOKEN)).listen(0);
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => server.close());

const prove = (body: unknown, token: string | null = TOKEN, path = "/prove") =>
  fetch(`${url}${path}`, {
    method: "POST",
    headers: token === null ? {} : { "x-cordon-token": token },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

test("authorized: constant-time match; an unset service token admits nobody", () => {
  expect(authorized(TOKEN, TOKEN)).toBe(true);
  expect(authorized("s3cret-tokeN", TOKEN)).toBe(false);
  expect(authorized("short", TOKEN)).toBe(false);
  expect(authorized(undefined, TOKEN)).toBe(false);
  expect(authorized("", "")).toBe(false);
});

test("proves a known circuit for an authorized caller", async () => {
  const r = await prove({ circuit: "transfer", inputs: {} });
  expect(r.status).toBe(200);
  expect(r.json.proof).toBe("0x0102");
  expect(r.json.publicInputs).toEqual(["0x01"]);
  expect(typeof r.json.ms).toBe("number");
  expect(proved).toEqual(["transfer"]);
});

test("refuses other routes, missing or wrong tokens, unknown circuits", async () => {
  expect((await fetch(`${url}/prove`)).status).toBe(404); // GET
  expect((await prove({}, TOKEN, "/other")).status).toBe(404);
  expect((await prove({ circuit: "transfer", inputs: {} }, null)).status).toBe(401);
  expect((await prove({ circuit: "transfer", inputs: {} }, "wrong-token!")).status).toBe(401);
  expect(await prove({ circuit: "order-forgery", inputs: {} })).toEqual({ status: 400, json: { error: "unknown circuit" } });
  expect(proved).toEqual(["transfer"]);
});

test("bad JSON and failed proofs answer 422 with the reason", async () => {
  expect((await prove("{not json")).status).toBe(422);
  expect(await prove({ circuit: "nav", inputs: { fail: true } })).toEqual({
    status: 422,
    json: { error: "Error: witness unsatisfied" },
  });
});
