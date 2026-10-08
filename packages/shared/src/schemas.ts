import { z } from "zod";

import { ASSET_CLASSES, ASSET_MODES, CLAIM_TYPES, ENCUMBRANCE_KINDS } from "./protocol";

/** Public asset registry row (mirrors `public.assets`). */
export const assetSchema = z.object({
  asset: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  symbol: z.string(),
  name: z.string(),
  class: z.enum(ASSET_CLASSES),
  claim_types: z.array(z.enum(CLAIM_TYPES)),
  templates: z.array(z.enum(ENCUMBRANCE_KINDS)),
  multiplier: z.string().nullable(),
  next_mult: z.string().nullable(),
  next_at: z.string().nullable(),
  mode: z.enum(ASSET_MODES),
});
export type Asset = z.infer<typeof assetSchema>;

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

/**
 * A workspace as stored off-chain: AES-GCM ciphertext produced in the browser.
 * The server never sees the key, the plaintext, or any amount/type field.
 */
export const encryptedWorkspaceSchema = z.object({
  ciphertext: base64.max(1_400_000),
  iv: base64.length(16),
  keyCheck: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EncryptedWorkspace = z.infer<typeof encryptedWorkspaceSchema>;

export const storedWorkspaceSchema = encryptedWorkspaceSchema.extend({
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type StoredWorkspace = z.infer<typeof storedWorkspaceSchema>;

export const putWorkspaceSchema = encryptedWorkspaceSchema.extend({
  /** Version the client last read; 0 creates the row. Mismatch → CONFLICT. */
  expectedVersion: z.number().int().nonnegative(),
});
