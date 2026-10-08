"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect } from "react";

import { SPRING } from "@/lib/motion";

import { useLoopReady } from "./stage";
import { useLoopGate } from "./use-loop-gate";

/** SPRING ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SPRING_FAST = {
  tension: SPRING.tension * 1.5,
  friction: SPRING.friction * 1.22,
} as const;

/** How far the chevrons step forward, px (viewBox = CSS px here). */
const STRIDE = 26;
/** Pause after the loop unlocks / comes back on screen before the first step. */
const LEAD = 320;
/** How long the chevrons hold forward before stepping back. */
const HOLD = 720;
/** Rest at the Figma position between steps. */
const REST = 2080;

/** The back chevron trails the front one by this share of the step. */
const LAG = 0.3;
const lead = (p: number) => Math.min(1, p / (1 - LAG));
const trail = (p: number) => Math.max(0, (p - LAG) / (1 - LAG));

/**
 * Panel glyph 3488:22873 — "Step forward", looping while the brand panel is on
 * screen. The SVG box scales with the frame's glyph (3888:7061 145 × 156,
 * 3888:11472 148 × 160 — kept at 300; 3876:100 138 × 150 → 285;
 * 3954:698 111 × 120 → 228), so the stride scales with it:
 * both chevrons step right (front one leading, both brightening a
 * touch), hold, spring back to the Figma resting state, rest, repeat.
 * One spring drives both. It waits for the footer entrance to settle
 * (`useLoopReady`), so it is the last thing to move; off screen it snaps to
 * rest and stops, and a return starts the cycle from its beginning.
 * Reduced motion keeps it static. Geometry is footer-panel-glyph.svg inlined.
 */
export const PanelGlyph = () => {
  const { ref, inView, reduced } = useLoopGate<SVGSVGElement>();
  const ready = useLoopReady();
  const [{ p }, api] = useSpring(() => ({ p: 0, config: SPRING_FAST }));

  useEffect(() => {
    if (!ready || !inView || reduced) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
    const run = async () => {
      await wait(LEAD);
      while (alive) {
        await api.start({ p: 1 });
        if (!alive) return;
        await wait(HOLD);
        if (!alive) return;
        await api.start({ p: 0 });
        if (!alive) return;
        await wait(REST);
      }
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
      api.stop();
      api.set({ p: 0 });
    };
  }, [ready, inView, reduced, api]);

  return (
    <svg
      ref={ref}
      aria-hidden="true"
      width={300}
      height={300}
      viewBox="0 0 300 300"
      fill="none"
      overflow="visible"
      className="absolute -top-10 left-74.75 block size-75 max-w-none w1024:-top-12 w1024:left-58.75 w768:-top-11 w768:left-119.25 w768:size-71.25 w768:[clip-path:inset(calc(var(--spacing)*17)_calc(var(--spacing)*24.5)_calc(var(--spacing)*16.75)_calc(var(--spacing)*12.25))] w390:-top-8.75 w390:[clip-path:inset(calc(var(--spacing)*13.75)_calc(var(--spacing)*19.25)_calc(var(--spacing)*13.25)_calc(var(--spacing)*10))] w390:left-44.75 w390:size-57"
    >
      <animated.image href="/brand/cordon-symbol.png" x="30" y="40" width="210" height="210" opacity={p.to((v)=>0.16 + 0.12 * lead(v))} style={{mixBlendMode:"screen",transform:p.to((v)=>`translateX(${STRIDE * trail(v)}px)`)}} />
    </svg>
  );
};
