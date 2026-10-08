"use client";

import { animated, easings } from "@react-spring/web";
import { useId } from "react";

import { pick, useFrame } from "@/hooks/use-frame";

import { loopFade, phase, useProofLoop } from "./use-proof-loop";

/** The 15 sample heights; only the x step changes between the frames. */
const SAMPLES = [
  52, 46, 48, 40, 42, 34, 28, 30, 22, 24, 16, 18, 10, 12, 4,
] as const;

const line = (end: number) =>
  SAMPLES.map(
    (y, i) => `${i ? "L" : "M"}${Number(((i * end) / 14).toFixed(4))} ${y}`,
  ).join("");

interface Geometry {
  /** Box width = viewBox width. */
  box: number;
  /** The line runs from 0 to `end`. */
  end: number;
  /** Centre of the "now" dot and x of the "now" line. */
  dot: number;
  path: string;
  /** End of the stroke gradient's vector, userSpaceOnUse. */
  gradient: readonly [number, number];
}

const geometry = (
  box: number,
  end: number,
  dot: number,
  gradient: readonly [number, number],
): Geometry => ({ box, end, dot, path: line(end), gradient });

/** 3888:6962 — 384 box, the line stops 6 short so the "now" dot fits. */
const G1440 = geometry(384, 378, 378, [22.961, 94.2887]);
/** 3888:11370 — 278 box, the line runs to the edge, the dot centres 1 in and
    overhangs the box by 2 (so does 768 3874:2 and 390 3893:4279). */
const G1024 = geometry(278, 278, 277, [29.6896, 89.8616]);
const G768 = geometry(218, 218, 217, [35.4876, 84.4794]);
/** 390 — the designer's box is 310 in a 308 card column. */
const G390 = geometry(310, 310, 309, [27.1935, 91.6954]);

/** Cycle clock, ms: line draws, area fades in under it, the dot lands and pulses. */
const DRAW = 720;
const AREA_AT = DRAW / 3;
const AREA = 480;
const DOT = 96;
const PULSE = 560;
const PLAY = DRAW + PULSE;

/**
 * Volume sparkline 3585:29599 (was proof-volume.svg, inlined to animate):
 * the line draws left → right, the area fades in under it, then the "now"
 * dot lands and its halo pulses (motion brief, proof "Draw in"). Loops
 * while on screen: play, hold the Figma frame, fade out, play again.
 */
export const Sparkline = ({ delay = 0 }: { delay?: number }) => {
  const { ref, t } = useProofLoop<SVGSVGElement>(PLAY, delay);
  const id = useId().replace(/:/g, "");
  const g = pick(useFrame(), {
    1440: G1440,
    1024: G1024,
    768: G768,
    390: G390,
  });

  const fade = t.to((v) => loopFade(v, PLAY));
  const offset = t.to((v) => 1 - easings.easeInOutCubic(phase(v, 0, DRAW)));
  const area = t.to((v) => easings.easeOutCubic(phase(v, AREA_AT, AREA)));
  const dot = t.to((v) => phase(v, DRAW, DOT));
  const pulse = (v: number) => easings.easeOutCubic(phase(v, DRAW, PULSE));
  const haloR = t.to((v) => 3 + 8 * pulse(v));
  const haloOpacity = t.to((v) => 0.8 * phase(v, DRAW, DOT) * (1 - pulse(v)));

  return (
    <svg
      ref={ref}
      width={g.box}
      height={56}
      viewBox={`0 0 ${g.box} 56`}
      fill="none"
      overflow="visible"
      className="block h-14 w-96 w1024:w-69.5 w768:w-54.5 w390:w-77.5"
    >
      <animated.g opacity={fade}>
        <g clipPath={`url(#${id}c)`}>
          <animated.path
            d={`${g.path}V56H0V52Z`}
            fill={`url(#${id}a)`}
            opacity={area}
          />
          <animated.path
            d={g.path}
            stroke={`url(#${id}l)`}
            strokeWidth={2}
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={offset}
          />
          <animated.circle
            cx={g.dot}
            cy={4}
            r={3}
            className="fill-accent"
            opacity={dot}
          />
          <animated.rect
            x={g.dot}
            y={4}
            width={1}
            height={52}
            fill={`url(#${id}n)`}
            opacity={dot}
          />
        </g>
        <animated.circle
          cx={g.dot}
          cy={4}
          r={haloR}
          className="stroke-accent"
          strokeWidth={1}
          opacity={haloOpacity}
        />
      </animated.g>
      <defs>
        <linearGradient
          id={`${id}a`}
          x1={0}
          y1={0}
          x2={0}
          y2={56}
          gradientUnits="userSpaceOnUse"
        >
          <stop
            className="[stop-color:var(--color-accent)]"
            stopOpacity={0.22}
          />
          <stop
            offset={1}
            className="[stop-color:var(--color-accent)]"
            stopOpacity={0}
          />
        </linearGradient>
        <linearGradient
          id={`${id}l`}
          x1={0}
          y1={4}
          x2={g.gradient[0]}
          y2={g.gradient[1]}
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset={0.4171}
            className="[stop-color:var(--color-proof-fill-from)]"
          />
          <stop offset={1} className="[stop-color:var(--color-accent)]" />
        </linearGradient>
        <linearGradient
          id={`${id}n`}
          x1={g.dot + 0.5}
          y1={4}
          x2={g.dot + 0.5}
          y2={56}
          gradientUnits="userSpaceOnUse"
        >
          <stop
            className="[stop-color:var(--color-accent)]"
            stopOpacity={0.9}
          />
          <stop
            offset={1}
            className="[stop-color:var(--color-accent)]"
            stopOpacity={0.1}
          />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <rect x={-1} y={-4} width={g.box + 6} height={64} />
        </clipPath>
      </defs>
    </svg>
  );
};
