"use client";

import { useState, useSyncExternalStore } from "react";

import { useDynamicInView } from "@/hooks/animation/use-dynamic-in-view";
import { VIEW_MARGIN } from "@/lib/view";

/** Delay from a card entering view to its own sequence: card rise (STEP) settles first. */
export const CARD_START = 240;

/**
 * Card visibility for the product row visuals.
 * `played` latches true on first entry (sequences play once);
 * `inView` stays live so loops run only while the card is visible.
 */
export const useCardPlay = () => {
  const [ref, inView] = useDynamicInView({ rootMargin: VIEW_MARGIN });
  const [played, setPlayed] = useState(false);
  if (inView && !played) setPlayed(true);
  return { ref, inView, played };
};

const REDUCE = "(prefers-reduced-motion: reduce)";

const subscribeReduced = (onChange: () => void) => {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** `prefers-reduced-motion: reduce` — loops render their resting state instead. */
export const useReducedMotionPref = () =>
  useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );
