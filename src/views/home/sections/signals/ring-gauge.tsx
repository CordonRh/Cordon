"use client";

import { animated, useSpring } from "@react-spring/web";

import { SPRING_SOFT } from "@/lib/motion";

import { useLoopPhase, useSeen } from "./use-signals-motion";

/** SPRING_SOFT ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SOFT_FAST = {
  tension: SPRING_SOFT.tension * 1.5,
  friction: SPRING_SOFT.friction * 1.22,
} as const;

/** Loop: draw (~1.45 s) → hold at 82% → ease back to 0 → again. */
const LOOP = { hold: 2800, reset: 1120 } as const;
const DRAW = 1440;

/**
 * Hands-off gauge (signals-ring.svg, inlined): the lime arc draws from 0 to
 * its 82% end while the figure counts up with it on the same spring, holds,
 * then eases back to 0 and draws again (loops while on screen).
 */
export const RingGauge = ({
  value,
  delay = 0,
}: {
  value: string;
  delay?: number;
}) => {
  const [ref, seen, inView] = useSeen();
  const { on, cycle } = useLoopPhase(seen, inView, {
    lead: delay,
    play: DRAW,
    ...LOOP,
  });
  const target = Number.parseInt(value, 10);
  const suffix = value.replace(/^\d+/, "");
  const { p } = useSpring({
    p: on ? 1 : 0,
    delay: on && cycle === 0 ? delay : 0,
    immediate: !seen,
    config: SOFT_FAST,
  });

  return (
    <>
      <svg
        ref={ref}
        aria-hidden="true"
        width={130}
        height={130}
        viewBox="0 0 130 130"
        fill="none"
        className="absolute top-15.5 left-31.5 size-32.5 w1024:top-15.25 w1024:left-40.75 w768:top-16.75 w768:left-25.75 w390:top-16.25 w390:left-24.75"
      >
        <path
          d="M65 119C94.8234 119 119 94.8234 119 65C119 35.1766 94.8234 11 65 11C35.1766 11 11 35.1766 11 65C11 94.8234 35.1766 119 65 119Z"
          strokeWidth={10}
          className="stroke-signals-ring-track"
        />
        <animated.path
          d="M65 11C76.6879 11.0309 88.0503 14.8532 97.3805 21.8927C106.711 28.9322 113.505 38.8089 116.743 50.0393C119.981 61.2698 119.488 73.2477 115.338 84.174C111.188 95.1003 103.605 104.385 93.7277 110.634C83.8504 116.883 72.2124 119.758 60.5615 118.829C48.9106 117.899 37.8758 113.214 29.1146 105.478C20.3534 97.7417 14.3387 87.3717 11.9739 75.9255C9.60906 64.4793 11.0218 52.5748 16 42"
          pathLength={1}
          strokeWidth={10}
          strokeLinecap="round"
          className="stroke-accent"
          style={{
            opacity: p.to((v) => (v > 0 ? 1 : 0)),
            strokeDasharray: p.to((v) => (v >= 1 ? "none" : "1 1")),
            strokeDashoffset: p.to((v) => 1 - v),
          }}
        />
      </svg>
      <p className="absolute top-26.75 left-31.5 w-32.5 text-center text-signals-stat leading-signals-stat font-medium tracking-signals-stat text-foreground w1024:top-27 w1024:left-40.75 w1024:text-signals-stat-1024 w1024:leading-signals-stat-1024 w768:top-28.5 w768:left-25.75 w390:top-29 w390:left-24.75 w390:text-signals-stat-390 w390:leading-signals-stat-390">
        <animated.span
          aria-hidden="true"
          style={{
            fontVariantNumeric: p.to((v) =>
              v >= 1 ? "normal" : "tabular-nums",
            ),
          }}
        >
          {p.to((v) => `${Math.round(v * target)}${suffix}`)}
        </animated.span>
        <span className="sr-only">{value}</span>
      </p>
    </>
  );
};
