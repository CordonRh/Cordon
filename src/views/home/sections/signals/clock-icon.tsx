"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useState } from "react";

import { SPRING } from "@/lib/motion";

import { useReducedMotionPref, useSeen } from "./use-signals-motion";

/** SPRING ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SPRING_FAST = {
  tension: SPRING.tension * 1.5,
  friction: SPRING.friction * 1.22,
} as const;

/** Full turn — slow enough to follow. */
const TURN_SPRING = { tension: 105, friction: 24.4 } as const;
/** Loop beat, ms: beat 0 turns, beats 4–6 tick 6° each, beat 7 rests. */
const BEAT = 640;
const BEATS = 8;
const TICK_FROM = 4;
const TICKS = 3;

/**
 * Next-run chip clock (signals-clock.svg, inlined): the hand makes a full
 * turn, then ticks forward a few times, and the next turn carries it round
 * to the next whole turn — a ~5.1 s loop while on screen. The hand is at its
 * Figma angle at every turn's end.
 */
export const ClockIcon = ({ delay = 0 }: { delay?: number }) => {
  const [ref, seen, inView] = useSeen();
  const reduced = useReducedMotionPref();
  const [beat, setBeat] = useState(0);
  const [started, setStarted] = useState(false);
  /* Fully off screen: back to the first turn for the next visit. */
  if (!seen && (started || beat !== 0)) {
    setStarted(false);
    setBeat(0);
  }

  useEffect(() => {
    if (!seen || started) return;
    const id = window.setTimeout(() => setStarted(true), delay);
    return () => window.clearTimeout(id);
  }, [seen, started, delay]);

  useEffect(() => {
    if (!started || !inView || reduced) return;
    const id = window.setInterval(() => setBeat((n) => n + 1), BEAT);
    return () => window.clearInterval(id);
  }, [started, inView, reduced]);

  const b = beat % BEATS;
  const turns = Math.floor(beat / BEATS) + 1;
  const ticks = Math.min(Math.max(b - TICK_FROM + 1, 0), TICKS);
  const { a } = useSpring({
    a: started ? 360 * turns + ticks * 6 : 0,
    immediate: !seen,
    config: b === 0 ? TURN_SPRING : SPRING_FAST,
  });

  return (
    <svg
      ref={ref}
      aria-hidden="true"
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      className="size-3.5 shrink-0 stroke-accent"
    >
      <path
        d="M7 12.4C9.98234 12.4 12.4 9.98234 12.4 7C12.4 4.01766 9.98234 1.6 7 1.6C4.01766 1.6 1.6 4.01766 1.6 7C1.6 9.98234 4.01766 12.4 7 12.4Z"
        strokeWidth={1.4}
      />
      <animated.path
        d="M7 4.2V7L9 8.4"
        strokeWidth={1.4}
        strokeLinecap="round"
        style={{
          transformOrigin: "7px 7px",
          transform: a.to((v) => (v % 360 === 0 ? "none" : `rotate(${v}deg)`)),
        }}
      />
    </svg>
  );
};
