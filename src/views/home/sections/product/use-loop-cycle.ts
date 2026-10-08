"use client";

import { useEffect, useRef, useState } from "react";

import { VIEW_MARGIN } from "@/lib/view";

import { useReducedMotionPref } from "./use-card-play";

/** Resting state held after each play before the visual resets, ms. */
export const LOOP_HOLD = 2800;
/** Time the reverse (reset) gets before the next play starts, ms. */
export const LOOP_RESET = 800;

/**
 * Looping driver for a product row visual.
 *
 * - `visible` — any pixel of the card on screen (plain observer, no margin).
 * - The loop arms only once the card is properly in view (VIEW_MARGIN line),
 *   so the first cycle starts from its first frame where the user is looking.
 * - While armed: `on` stays true for `playMs` + LOOP_HOLD, flips off for
 *   LOOP_RESET so every spring reverses smoothly, then plays again.
 * - Leaving the screen disarms it and `snap` asks the springs to jump to the
 *   start state, so coming back replays from the beginning.
 * Reduced motion → `on` stays true and `snap` makes every spring immediate.
 */
export const useLoopCycle = (playMs: number) => {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotionPref();
  const [visible, setVisible] = useState(false);
  const [inLine, setInLine] = useState(false);
  const [armed, setArmed] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const any = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    const line = new IntersectionObserver(
      ([entry]) => setInLine(entry.isIntersecting),
      { rootMargin: VIEW_MARGIN },
    );
    any.observe(el);
    line.observe(el);
    return () => {
      any.disconnect();
      line.disconnect();
    };
  }, []);

  // Arm when properly in view; disarm (and reset) only once fully off screen.
  if (visible && inLine && !armed) setArmed(true);
  if (!visible && armed) setArmed(false);

  useEffect(() => {
    if (!armed || reduced) {
      setOn(false);
      return;
    }
    let timer = 0;
    const play = () => {
      setOn(true);
      timer = window.setTimeout(reset, playMs + LOOP_HOLD);
    };
    const reset = () => {
      setOn(false);
      timer = window.setTimeout(play, LOOP_RESET);
    };
    play();
    return () => window.clearTimeout(timer);
  }, [armed, reduced, playMs]);

  return {
    ref,
    on: on || reduced,
    visible,
    reduced,
    /** Springs jump instead of animate: reduced motion, or reset while off screen. */
    snap: reduced || !visible,
  };
};
