import { STEP } from "@/lib/motion";

/**
 * Load scenario "System load" (~1.45 s) — ms after the hero enters view.
 * Copy on the left cascades on STEP in parallel with the window sequence:
 * frame → grid wave → nodes in flow order → connectors → first packet.
 */
export const LOAD = {
  copy: {
    chip: 0,
    chipType: 120,
    title: STEP,
    subhead: 2 * STEP,
    actions: 3 * STEP,
    note: 4 * STEP,
    noteType: 4 * STEP + 120,
  },
  frame: 0,
  grid: 192,
  chrome: 288,
  /** Refund created → Amount over 5000 → Log to warehouse → Ask finance. */
  nodes: [416, 416 + 0.8 * STEP, 416 + 1.6 * STEP, 416 + 2.4 * STEP],
  /** Refund created → true / else branches, then the branches into Ask finance. */
  connectorsIn: 608,
  connectors: 688,
  targetPort: 896,
  status: 896,
  runs: 800,
  /** The particle stream starts drawing itself in, with the first node. */
  stream: 416,
  /** First packet leaves Refund created; the live loop continues from here. */
  packet: 944,
} as const;

/** Live run ("Live run"). */
export const LIVE = {
  /** One packet trip, ms. */
  trip: 720,
  /** Trip start to next trip start, ms. */
  period: 1920,
  /** Every Nth trip takes the grey branch through Log to warehouse. */
  greyEvery: 3,
  /** Port flash fall-off, ms. */
  flash: 416,
  /** A new "last runs" row every … ms. */
  runEvery: 4000,
  /** Row pitch in rem, so it tracks the adaptive grid: 34 at 1440 (21 row +
      13 gap), 28 at 1024 (3719:3458 — 20 row + 8 gap). */
  rowPitch: 2.125,
  rowPitch1024: 1.75,
} as const;

/** Cursor tilt ("3D tilt"). */
export const TILT = {
  /** ±deg at the pointer's reach — raised from 3 for a stronger tilt */
  deg: 12,
  perspective: 1400,
  bloom: 60,
  /** Parallax depth per layer, px. */
  depth: { grid: 10, flow: 22, front: 34 },
} as const;
