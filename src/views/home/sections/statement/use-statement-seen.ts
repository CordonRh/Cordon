"use client";

import { createContext, useContext } from "react";

export interface StatementMotion {
  /** Plate top at/above 40% of the viewport; false again once fully off screen. */
  seen: boolean;
  /** Any part of the plate is on screen — gates the loops. */
  inView: boolean;
  reduced: boolean;
}

export const StatementMotionContext = createContext<StatementMotion>({
  seen: false,
  inView: false,
  reduced: false,
});

/**
 * Shared trigger for every motion leaf of the Statement plate (provided by
 * `StatementPlate`), so all timelines (see `TIMELINE`) start on one frame.
 */
export const useStatementSeen = () => useContext(StatementMotionContext);

/** Section timeline, ms after the plate has opened on screen. */
/*
 * Order, top-down from where the iris opened: the logo lands first, then the
 * title rises word by word with the kicker typing above it, then the stem
 * drops from the logo to the ruler, "now" (dot + label) pops where it lands,
 * and last the ruler draws out left → right with its caption.
 */
export const TIMELINE = {
  tile: 0,
  title: 380,
  titleStep: 60,
  kicker: 460,
  stem: 1150,
  nowPop: 1600,
  wave: 1750,
  caption: 1800,
  chevronEvery: 4000,
} as const;

/** Ruler wave: one pass left → right, ms; rest at Figma between passes, ms. */
export const WAVE = { pass: 1600, hold: 3600 } as const;

/** Small overshoot for the tile landing and the "now" dot pop. */
export const DROP = { tension: 260, friction: 15 } as const;
export const POP = { tension: 420, friction: 14 } as const;

/**
 * TypeText clips with `round(down, n·1ch, 1ch)`, which float error can land
 * one glyph short at rest ("one tick, one run" lost its "n"). Same clip with
 * a half-pixel nudge; `!` beats TypeText's inline clip-path.
 */
export const TYPE_CLIP =
  "[clip-path:inset(0_calc(100%_-_round(down,_calc(var(--typed)_*_1ch_+_0.5px),_1ch)_-_0.1ch)_0_0)]!";
