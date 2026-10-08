/**
 * Motion presets for the Relay page — chosen in the motion brief
 * (artifact 1ZSdWxVihDShHs6RoFiWK7, doc picks/current).
 *
 * Plain serialisable values only: this module is imported by Server
 * Components, so nothing here may carry a function.
 */

/** "Precise mechanism": short, dense springs with no overshoot (~450 ms). */
export const SPRING = { tension: 280, friction: 32 } as const;

/** Slower settle for things the eye has to follow: blur-ins, sweeps, strokes. */
export const SPRING_SOFT = { tension: 120, friction: 26 } as const;

/** Stagger step between siblings, ms. */
export const STEP = 70;

export const REVEAL = {
  from: { opacity: 0, y: 24 },
  to: { opacity: 1, y: 0 },
  step: STEP,
} as const;

export const FADE = {
  from: { opacity: 0 },
  to: { opacity: 1 },
} as const;
