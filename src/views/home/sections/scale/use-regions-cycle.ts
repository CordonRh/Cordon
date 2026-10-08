"use client";

import { useEffect, useRef, useState } from "react";

import { VIEW_MARGIN } from "@/lib/view";

/**
 * `off`   — hidden / not yet seen: lanes empty, jump there instantly.
 * `play`  — bars grow, count up, heads pulse, lock snaps.
 * `reset` — everything eases back to empty before the next play.
 */
export type RegionsPhase = "off" | "play" | "reset";

/** Last bar starts at 6 × STEP, SPRING_SOFT (×1.5 tension here) settles in ~1.1 s, halo ~0.8 s. */
const PLAY_MS = 1_920;
/** Held on the Figma resting frame. */
const HOLD_MS = 2_800;
/** Reverse of the grow spring, staggered. */
const RESET_MS = 1_280;

/**
 * Loop driver for the regions art. The first play starts only once the lanes
 * are properly seen (VIEW_MARGIN); when they leave the screen entirely the
 * loop drops to `off` (empty lanes, instantly) and the next visit waits for
 * VIEW_MARGIN again, so every visit plays from its first frame. Reduced
 * motion parks it on `play` (the resting state), with springs set to immediate.
 */
export const useRegionsCycle = <T extends Element>() => {
  const ref = useRef<T>(null);
  /** Properly seen on this visit; false again once fully off screen. */
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<RegionsPhase>("off");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setActive(true);
      },
      { rootMargin: VIEW_MARGIN },
    );
    const gone = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setActive(false);
    });
    /* Start with the card (its reveal), not the lanes further down it. */
    seen.observe(node.closest("article") ?? node);
    gone.observe(node);
    return () => {
      seen.disconnect();
      gone.disconnect();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => setPhase("play"), 0);
      return () => clearTimeout(t);
    }
    if (!active) return;

    let timer: ReturnType<typeof setTimeout>;
    const play = () => {
      setPhase("play");
      timer = setTimeout(reset, PLAY_MS + HOLD_MS);
    };
    const reset = () => {
      setPhase("reset");
      timer = setTimeout(play, RESET_MS);
    };
    timer = setTimeout(play, 0);

    return () => {
      clearTimeout(timer);
      setPhase("off");
    };
  }, [active, reduced]);

  return { ref, phase, reduced };
};
