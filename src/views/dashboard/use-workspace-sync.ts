"use client";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useRef, useState } from "react";

import { backendEnabled } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { signWithWallet, walletProvider, type useCordonWallet } from "@/lib/wallet";
import {
  WORKSPACE_KEY_MESSAGE,
  decryptJson,
  deriveWorkspaceKey,
  encryptJson,
  type WorkspaceKey,
} from "@/lib/workspace-crypto";

import { isWorkspace, mergeWorkspaces, type Workspace } from "./model";

export type SyncState = "off" | "working" | "synced" | "error";

const SIGN_IN_STATEMENT = "Sign in to Cordon. This does not approve a transaction or move assets.";

const isConflict = (e: unknown) => e instanceof TRPCClientError && e.data?.code === "CONFLICT";

/**
 * Encrypted workspace sync. Nothing leaves the browser unencrypted: the key is
 * derived from a wallet signature and held in memory only for this page.
 */
export function useWorkspaceSync(
  workspace: Workspace,
  setWorkspace: (w: Workspace) => void,
  wallet: ReturnType<typeof useCordonWallet>,
) {
  const [state, setState] = useState<SyncState>("off");
  const [error, setError] = useState("");
  const key = useRef<WorkspaceKey | null>(null);
  const version = useRef(0);
  const pushed = useRef<Workspace | null>(null);
  const latest = useRef(workspace);
  latest.current = workspace;

  const pull = useCallback(async (): Promise<Workspace | null> => {
    const remote = await trpc.workspace.get.query();
    version.current = remote?.version ?? 0;
    if (!remote) return null;
    if (remote.keyCheck !== key.current!.keyCheck) {
      throw new Error(
        "This wallet produced a different key than the one that encrypted your synced workspace, so it was left untouched.",
      );
    }
    const data = await decryptJson<unknown>(key.current!.key, remote);
    if (!isWorkspace(data)) throw new Error("The synced workspace could not be read.");
    return data;
  }, []);

  const push = useCallback(async (w: Workspace) => {
    const sealed = await encryptJson(key.current!.key, w);
    const saved = await trpc.workspace.put.mutate({
      ...sealed,
      keyCheck: key.current!.keyCheck,
      expectedVersion: version.current,
    });
    version.current = saved.version;
    pushed.current = w;
  }, []);

  /** Push, and on a concurrent write from another device merge and retry once. */
  const save = useCallback(
    async (w: Workspace) => {
      try {
        await push(w);
      } catch (e) {
        if (!isConflict(e)) throw e;
        const remote = await pull();
        const merged = remote ? mergeWorkspaces(w, remote) : w;
        setWorkspace(merged);
        await push(merged);
      }
    },
    [pull, push, setWorkspace],
  );

  const stop = useCallback(async () => {
    key.current = null;
    version.current = 0;
    pushed.current = null;
    setState("off");
    setError("");
    await getSupabase()?.auth.signOut({ scope: "local" });
  }, []);

  const start = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase || !wallet.connector) return;
    setState("working");
    setError("");
    try {
      // Always sign in as the wallet connected now, never a stored session of another one.
      await supabase.auth.signOut({ scope: "local" });
      const { error: signInError } = await supabase.auth.signInWithWeb3({
        chain: "ethereum",
        // Same EIP-1193 provider; Supabase and viem type its events differently.
        wallet: (await walletProvider(wallet.connector)) as never,
        statement: SIGN_IN_STATEMENT,
      });
      if (signInError) throw signInError;
      key.current = await deriveWorkspaceKey(await signWithWallet(WORKSPACE_KEY_MESSAGE));
      const remote = await pull();
      const merged = remote ? mergeWorkspaces(latest.current, remote) : latest.current;
      setWorkspace(merged);
      await save(merged);
      setState("synced");
    } catch (e) {
      key.current = null;
      setState("error");
      setError((e as Error).message || "Sync could not be started.");
    }
  }, [pull, save, setWorkspace, wallet.connector]);

  // Keep the synced copy current (debounced) while sync is on.
  useEffect(() => {
    if (state !== "synced" || !key.current || pushed.current === workspace) return;
    const id = setTimeout(() => {
      save(workspace).catch((e) => {
        setState("error");
        setError((e as Error).message || "Your latest changes could not be synced.");
      });
    }, 1500);
    return () => clearTimeout(id);
  }, [workspace, state, save]);

  // A different (or no) wallet must never keep another wallet's session or key.
  const owner = useRef(wallet.address);
  useEffect(() => {
    if (owner.current && owner.current !== wallet.address) void stop();
    owner.current = wallet.address;
  }, [wallet.address, stop]);

  return { available: backendEnabled, state, error, start, stop };
}
