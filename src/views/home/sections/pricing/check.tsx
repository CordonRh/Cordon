"use client";

import { animated, useSpring } from "@react-spring/web";
import { SPRING, SPRING_SOFT } from "@/lib/motion";

/** SPRING_SOFT ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SOFT_FAST = {
  tension: SPRING_SOFT.tension * 1.5,
  friction: SPRING_SOFT.friction * 1.22,
} as const;
/** SPRING ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SPRING_FAST = {
  tension: SPRING.tension * 1.5,
  friction: SPRING.friction * 1.22,
} as const;

/**
 * The 1024, 768 and 390 frames draw the mark narrower — 10 × 16 with its own path
 * (3603:4248) instead of 16 × 16 — so both are rendered and the `w1024:`
 * variant picks one; they share the springs, so the motion is identical.
 */
const GLYPH = {
  wide: { box: "16 16", d: "M3.5 8.5L6.5 11.5L12.5 4.5" },
  narrow: { box: "10 16", d: "M1 8.5L2.77778 11.5L6.33333 4.5" },
} as const;

/**
 * List check (pricing-check*.svg, inlined) — pops in and draws its stroke once
 * its card is properly on screen (plays once, never re-hides). Delays stagger
 * it top → bottom inside each card.
 */
export const Check = ({
  light,
  seen: inView,
  delay,
}: {
  light: boolean;
  /** The card has been properly seen (TierCard's useSeen). */
  seen: boolean;
  delay: number;
}) => {
  const { pop } = useSpring({
    pop: inView ? 1 : 0,
    delay,
    config: SPRING_FAST,
  });
  const { draw } = useSpring({
    draw: inView ? 0 : 1,
    delay: delay + 48,
    config: SOFT_FAST,
  });

  return (
    <animated.span
      aria-hidden="true"
      className="mt-0.5 block size-4 shrink-0 w1024:mt-1.5 w1024:w-2.5 w768:mt-0.5 w390:mt-1"
      style={{
        opacity: pop,
        // No transform at rest: the glyph rasterises like the static icon.
        transform: pop.to((v) => (v >= 1 ? "none" : `scale(${0.5 + 0.5 * v})`)),
      }}
    >
      {(["wide", "narrow"] as const).map((size) => (
        <svg
          key={size}
          viewBox={`0 0 ${GLYPH[size].box}`}
          fill="none"
          className={
            size === "wide"
              ? "block size-4 overflow-visible w1024:hidden"
              : "hidden h-4 w-2.5 overflow-visible w1024:block"
          }
        >
          <animated.path
            d={GLYPH[size].d}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={draw}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={
              light ? "stroke-pricing-check-light" : "stroke-pricing-check"
            }
          />
        </svg>
      ))}
    </animated.span>
  );
};
