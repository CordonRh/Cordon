import { STEP } from "@/lib/motion";

/**
 * Proof section cascade, ms. Head: badge/title 0 → title focus STEP → aside
 * 2·STEP → top hairline 3·STEP. Each stat column starts two steps after the
 * previous one; inside a column: label types, number counts, caption fades,
 * the mini visual plays, then the trend pill rises and the quote fades.
 */
export const PROOF_TIMING = {
  hairlineTop: 3 * STEP,
  hairlineBottom: 5 * STEP,
  column: (i: number) => 3 * STEP + i * 2 * STEP,
  number: STEP,
  caption: 2 * STEP,
  visual: 3 * STEP,
  /** How long each mini visual takes to land. */
  visualLength: { sparkline: 880, hours: 1000, progress: 1600 },
  count: 1400,
  /** First play of each mini visual after it is seen: a short column stagger. */
  visualStagger: (i: number) => i * 1.6 * STEP,
  /** Quote row: columns 90 ms apart, name and role right behind the quote. */
  quoteStagger: (i: number) => i * 90,
  quoteName: 150,
  quoteRole: 220,
} as const;
