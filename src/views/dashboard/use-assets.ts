"use client";
import { useQuery } from "@tanstack/react-query";

import { backendEnabled } from "@/lib/env";
import { trpc } from "@/lib/trpc";

import { fallbackAssets, type AssetOption } from "./model";

/** Registered assets that accept new requests; the built-in list until the registry answers. */
export function useAssetOptions(): AssetOption[] {
  const { data } = useQuery({
    queryKey: ["assets"],
    queryFn: () => trpc.assets.list.query(),
    enabled: backendEnabled,
    staleTime: 60_000,
    retry: 1,
  });
  const active = data?.filter((a) => a.mode === "ACTIVE") ?? [];
  return active.length
    ? active.map((a) => ({ name: a.name, claims: a.claim_types, address: a.asset }))
    : fallbackAssets;
}
