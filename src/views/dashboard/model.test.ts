import { describe, expect, test } from "bun:test";

import { createRecord, initial, isWorkspace, mergeCursors, mergeWorkspaces, pledgeCodes, type Workspace } from "./model";

const record = (name: string, created: string, status: "Prepared" | "Archived" = "Prepared") => ({
  ...createRecord("bundles", { name, amount: "10" }),
  created,
  status,
});

describe("mergeWorkspaces", () => {
  test("a fresh device adopts the synced workspace", () => {
    const remote: Workspace = {
      name: "Desk",
      hideValues: true,
      requests: [record("a", "2026-01-01")],
    };
    expect(mergeWorkspaces(initial, remote)).toEqual(remote);
  });

  test("unions requests by id; this device's edits and preferences win", () => {
    const shared = record("shared", "2026-01-02");
    const local: Workspace = {
      name: "Local",
      hideValues: false,
      requests: [{ ...shared, status: "Archived" }],
    };
    const remote: Workspace = {
      name: "Remote",
      hideValues: true,
      requests: [shared, record("other", "2026-01-03")],
    };
    const merged = mergeWorkspaces(local, remote);
    expect(merged.name).toBe("Local");
    expect(merged.hideValues).toBe(false);
    expect(merged.requests.map((r) => r.name)).toEqual(["other", "shared"]);
    expect(merged.requests.find((r) => r.id === shared.id)?.status).toBe("Archived");
  });
});

describe("isWorkspace", () => {
  test("accepts a valid workspace and rejects malformed data", () => {
    expect(
      isWorkspace({ name: "x", hideValues: false, requests: [record("a", "2026-01-01")] }),
    ).toBe(true);
    expect(isWorkspace(null)).toBe(false);
    expect(isWorkspace({ name: "x", requests: [{ id: 1 }] })).toBe(false);
  });
});

describe("notes", () => {
  const note = (commit: string, status: "pending" | "live" | "spent") => ({ commit, status });
  test("a note spent on either device stays spent; new notes from both sides are kept", () => {
    const local = { ...initial, name: "Mine", requests: [], notes: [note("1", "live"), note("2", "spent"), note("3", "live")] };
    const remote = { ...initial, notes: [note("1", "spent"), note("2", "live"), note("4", "live")] };
    const merged = mergeWorkspaces(local, remote);
    const status = Object.fromEntries((merged.notes ?? []).map((n) => [n.commit, n.status]));
    expect(status).toEqual({ "1": "spent", "2": "spent", "3": "live", "4": "live" });
    expect(isWorkspace(merged)).toBe(true);
  });
});

test("a pledge code is single-use, also across boxes opened in one pass", () => {
  const free = pledgeCodes([{ enc: "0xa", nonce: "1", locked: { commit: "c", status: "live" } }]);
  expect(free({ enc: "0xa", nonce: "1" })).toBe(true); // the same pledge again
  expect(free({ enc: "0xb", nonce: "1" })).toBe(false); // an old code reused
  expect(free({ enc: "0xc", nonce: "2" })).toBe(true);
  expect(free({ enc: "0xd", nonce: "2" })).toBe(false); // reused within the same pass
});

test("inbox cursors are kept per wallet and merge to the furthest read", () => {
  expect(mergeCursors({ "0xa": 11, "0xb": 3 }, { "0xa": 9, "0xc": 5 })).toEqual({ "0xa": 11, "0xb": 3, "0xc": 5 });
  expect(mergeCursors(undefined, undefined)).toEqual({});
});
