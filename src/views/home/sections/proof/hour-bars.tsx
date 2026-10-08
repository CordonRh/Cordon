"use client";

import { animated, easings } from "@react-spring/web";
import { useId } from "react";

import { pick, useFrame } from "@/hooks/use-frame";

import { loopFade, phase, useProofLoop } from "./use-proof-loop";

/** 11 lit bars, radius 6 (was the proof-hours.svg union). */
const LIT = 11;
const HEIGHT = 56;

interface Geometry {
  /** Union width = viewBox width. */
  span: number;
  pitch: number;
  width: number;
  /** End of the fill gradient's vector, userSpaceOnUse. */
  gradient: readonly [number, number];
}

/** 3888:6927 — 20-wide bars on a 28 pitch across 300. */
const G1440: Geometry = {
  span: 300,
  pitch: 28,
  width: 20,
  gradient: [36.7842, 98.398],
};

/** 3888:11332 — the same 11 bars squeezed into 218 at 1024. */
const G1024: Geometry = {
  span: 218,
  pitch: 20.3467,
  width: 14.5332,
  gradient: [45.6208, 88.6796],
};

/** 3832:8585 — 11.86-wide bars on a 15.86 pitch across 170.43 at 768. */
const G768: Geometry = {
  span: 170.429,
  pitch: 15.8571,
  width: 11.8574,
  gradient: [51.5176, 78.2171],
};

/** 3893:4241 — 18-wide bars on a 22.46 pitch across 242.62 at 390. */
const G390: Geometry = {
  span: 242.615,
  pitch: 22.4615,
  width: 18,
  gradient: [42.6534, 92.4756],
};

/** Cycle clock, ms: each bar grows over RISE, the next one BAR_STEP later. */
const BAR_STEP = 48;
const RISE = 520;
const PLAY = (LIT - 1) * BAR_STEP + RISE;

/**
 * Hour bars 3585:29609: the lit bars fill from the bottom one after another
 * (motion brief, proof "Draw in"). The dim bars are static siblings. Loops
 * while on screen: fill, hold the Figma frame, fade out, fill again.
 */
export const HourBars = ({ delay = 0 }: { delay?: number }) => {
  const { ref, t } = useProofLoop<SVGSVGElement>(PLAY, delay);
  const id = useId().replace(/:/g, "");
  const g = pick(useFrame(), {
    1440: G1440,
    1024: G1024,
    768: G768,
    390: G390,
  });

  const fade = t.to((v) => loopFade(v, PLAY));
  const height = (i: number) =>
    t.to((v) => HEIGHT * easings.easeOutCubic(phase(v, i * BAR_STEP, RISE)));

  return (
    <svg
      ref={ref}
      width={g.span}
      height={HEIGHT}
      viewBox={`0 0 ${g.span} 56`}
      fill="none"
      className="absolute top-0 left-0 block h-14 w-75 w1024:w-54.5 w768:w-[calc(var(--spacing)*42.6072)] w390:w-[calc(var(--spacing)*60.6538)]"
    >
      <animated.g opacity={fade}>
        {Array.from({ length: LIT }, (_, i) => {
          const h = height(i);
          return (
            <animated.rect
              key={i}
              x={i * g.pitch}
              y={h.to((v) => HEIGHT - v)}
              width={g.width}
              height={h}
              rx={6}
              fill={`url(#${id}g)`}
            />
          );
        })}
      </animated.g>
      <defs>
        <linearGradient
          id={`${id}g`}
          x1={0}
          y1={0}
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
      </defs>
    </svg>
  );
};
