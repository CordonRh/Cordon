"use client";

import {
  easings,
  useReducedMotion,
  useSpring,
  type SpringValue,
} from "@react-spring/web";
import { useEffect } from "react";

import { useProofSeen } from "./use-proof-seen";

/** Resting (Figma) frame held between plays, ms. */
export const LOOP_HOLD = 2720;
/** Soft reset: the drawn marks fade out, ms. */
export const LOOP_FADE = 360;
/** Empty beat before the next play, ms. */
export const LOOP_GAP = 280;

/** 0 → 1 over [start, start + length] of the cycle clock, clamped. */
export const phase = (t: number, start: number, length: number) =>
  Math.min(1, Math.max(0, (t - start) / length));

/** Opacity of the drawn marks: 1 while playing and holding, fades on reset. */
export const loopFade = (t: number, play: number) =>
  1 - easings.easeInOutQuad(phase(t, play + LOOP_HOLD, LOOP_FADE));

/**
 * One linear clock per mini visual: `t` runs 0 → play + hold + fade + gap
 * and repeats while the visual is on screen. Each visual maps `t` onto its
 * marks with interpolations, so a loop costs a single spring.
 *
 * - Play starts from t = 0 only once the element is properly seen
 *   (VIEW_MARGIN) plus a short column stagger `delay`.
 * - Leaving the screen entirely stops the clock and parks it at 0 (invisible,
 *   so no jump); coming back re-arms, and the loop starts again from its
 *   first frame once the element is properly seen again.
 * - Reduced motion parks the clock on the resting frame.
 */
export const useProofLoop = <T extends Element>(play: number, delay = 0) => {
  const { ref, seen } = useProofSeen<T>();
  const reduced = useReducedMotion();
  const cycle = play + LOOP_HOLD + LOOP_FADE + LOOP_GAP;

  const [{ t }, api] = useSpring(() => ({ t: 0 }));

  const active = seen && !reduced;

  useEffect(() => {
    if (reduced) {
      api.set({ t: play });
      return;
    }
    if (!active) {
      api.stop();
      api.set({ t: 0 });
      return;
    }
    let alive = true;
    const run = async () => {
      let first = true;
      while (alive) {
        api.set({ t: 0 });
        const [result] = await Promise.all(
          api.start({
            t: cycle,
            delay: first ? delay : 0,
            config: { duration: cycle, easing: easings.linear },
          }),
        );
        if (!result || result.cancelled) break;
        first = false;
      }
    };
    void run();
    return () => {
      alive = false;
      api.stop();
    };
  }, [active, reduced, api, play, cycle, delay]);

  return { ref, t: t as SpringValue<number> };
};
