"use client";

import { useSyncExternalStore } from "react";

/**
 * Which Figma frame is laid out right now — the same lines as the `w1024:`,
 * `w768:` and `w390:` Tailwind variants in globals.css. Only for the few px
 * lengths baked into motion that classes cannot carry; timings never depend
 * on it. Server render and first paint assume 1440.
 */
export type Frame = 1440 | 1024 | 768 | 390;

const QUERIES: readonly [Frame, string][] = [
  [390, "(max-width: 580px)"],
  [768, "(max-width: 900px)"],
  [1024, "(max-width: 1200px)"],
];

const read = (): Frame => {
  for (const [frame, query] of QUERIES) {
    if (window.matchMedia(query).matches) return frame;
  }
  return 1440;
};

const subscribe = (onChange: () => void) => {
  const lists = QUERIES.map(([, query]) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", onChange));
  return () =>
    lists.forEach((list) => list.removeEventListener("change", onChange));
};

export const useFrame = (): Frame =>
  useSyncExternalStore(subscribe, read, () => 1440);

/** Pick the value for the active frame; narrower frames fall back to wider ones. */
export const pick = <T>(
  frame: Frame,
  values: { 1440: T; 1024?: T; 768?: T; 390?: T },
): T => {
  if (frame === 390)
    return values[390] ?? values[768] ?? values[1024] ?? values[1440];
  if (frame === 768) return values[768] ?? values[1024] ?? values[1440];
  if (frame === 1024) return values[1024] ?? values[1440];
  return values[1440];
};
