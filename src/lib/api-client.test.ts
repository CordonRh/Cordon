import { afterEach, expect, spyOn, test } from "bun:test";

import { ApiClientError, apiFetch } from "./api-client";

const respond = (body: string, status = 200) =>
  spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }));
let spy: ReturnType<typeof respond> | undefined;
afterEach(() => spy?.mockRestore());

test("unwraps data and sends JSON headers merged with the caller's", async () => {
  spy = respond(JSON.stringify({ data: { ok: 1 } }));
  expect(
    await apiFetch<{ ok: number }>("/api/x", { method: "POST", headers: { "x-a": "1" } }),
  ).toEqual({ ok: 1 });
  const [path, init] = spy.mock.calls[0] as [string, RequestInit];
  expect(path).toBe("/api/x");
  expect(init).toMatchObject({
    method: "POST",
    headers: { "content-type": "application/json", "x-a": "1" },
  });
});

test("an error envelope becomes an ApiClientError with its code and status", async () => {
  spy = respond(JSON.stringify({ error: { code: "invalid", message: "Bad input." } }), 422);
  const e = (await apiFetch("/api/x").catch((x) => x)) as ApiClientError;
  expect(e).toBeInstanceOf(ApiClientError);
  expect([e.name, e.code, e.message, e.status]).toEqual([
    "ApiClientError",
    "invalid",
    "Bad input.",
    422,
  ]);
});

test("a non-JSON failure is a generic request_failed", async () => {
  spy = respond("<html>502</html>", 502);
  await expect(apiFetch("/api/x")).rejects.toMatchObject({ code: "request_failed", status: 502 });
});

test("an error envelope fails even with a 200", async () => {
  spy = respond(JSON.stringify({ error: { code: "x", message: "y" } }));
  await expect(apiFetch("/api/x")).rejects.toMatchObject({ code: "x", status: 200 });
});
