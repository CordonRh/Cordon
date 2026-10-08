/** Protocol constants shared by the app, API, workers and SDK (spec §2–§3). */

export const CLAIM_TYPES = ["PRINCIPAL", "INCOME", "VOTE", "REDEEM", "CONTROL"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const ENCUMBRANCE_KINDS = ["LOCKUP", "PLEDGE", "LIEN"] as const;
export type EncumbranceKind = (typeof ENCUMBRANCE_KINDS)[number];

export const ASSET_CLASSES = ["STOCK8056", "TREASURY", "VAULT4626"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** `REDEEM_ONLY` is entered on delisting/registry removal: unbundle + withdraw only. */
export const ASSET_MODES = ["ACTIVE", "REDEEM_ONLY"] as const;
export type AssetMode = (typeof ASSET_MODES)[number];

/** Claim types each asset class can be bundled into (a USDG vault has no VOTE). */
export const CLAIMS_BY_CLASS: Record<AssetClass, readonly ClaimType[]> = {
  STOCK8056: CLAIM_TYPES,
  TREASURY: ["PRINCIPAL", "INCOME", "REDEEM", "CONTROL"],
  VAULT4626: ["PRINCIPAL", "INCOME", "REDEEM", "CONTROL"],
};

export const FEES_BPS = {
  bundle: 10,
  dvpLeg: 5,
  encumbrancePerYear: 2,
} as const;

export const MAX_DVP_LEGS = 16;
export const DVP_BATCH_SECONDS = 60;
export const DEPOSIT_STANDBY_SECONDS = 15 * 60;

/** Copy rules (spec §8): these words must never appear in product copy. */
export const BLOCKED_COPY_TERMS = [
  "security",
  "share class",
  "derivative",
  "structured note",
  "APY",
  "untraceable",
  "hide",
] as const;
