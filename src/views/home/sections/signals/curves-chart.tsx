"use client";

import { animated, useSpring } from "@react-spring/web";
import { useCallback, useRef } from "react";

import { SPRING_SOFT } from "@/lib/motion";

import {
  useAfter,
  useFrameLoop,
  useReducedMotionPref,
  useSeen,
} from "./use-signals-motion";

/** SPRING_SOFT ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SOFT_FAST = {
  tension: SPRING_SOFT.tension * 1.5,
  friction: SPRING_SOFT.friction * 1.22,
} as const;

type Pt = readonly [number, number];
/** Start point + three cubic segments [c1, c2, end] (signals-curves.svg). */
type Curve = { m: Pt; segs: readonly (readonly [Pt, Pt, Pt])[] };

const RECOVERED: Curve = {
  m: [0, 78],
  segs: [
    [
      [60.8333, 78],
      [76.0417, 26],
      [128.185, 30],
    ],
    [
      [182.5, 34],
      [193.363, 84],
      [252.024, 82],
    ],
    [
      [310.685, 80],
      [325.893, 40],
      [365, 36],
    ],
  ],
};
const FAILED: Curve = {
  m: [0, 34],
  segs: [
    [
      [60.8333, 34],
      [76.0417, 86],
      [128.185, 82],
    ],
    [
      [182.5, 78],
      [193.363, 28],
      [252.024, 30],
    ],
    [
      [310.685, 32],
      [325.893, 72],
      [365, 76],
    ],
  ],
};
const RECOVERED_D =
  "M0 78C60.8333 78 76.0417 26 128.185 30C182.5 34 193.363 84 252.024 82C310.685 80 325.893 40 365 36";
const FAILED_D =
  "M0 34C60.8333 34 76.0417 86 128.185 82C182.5 78 193.363 28 252.024 30C310.685 32 325.893 72 365 76";

/** Crossing marker centres in the frame (3888:6630…6632), left → right. */
const MARKS: readonly Pt[] = [
  [62, 56],
  [185, 56],
  [322, 56],
];
/** Drift: loop length and horizontal amplitude of the inner turns, px. */
const PERIOD = 4800;
const AMP = 10;

/** Shift every point except the fixed ends by dx. */
const shift = (c: Curve, dx: number): Curve => ({
  m: c.m,
  segs: c.segs.map((seg, s) =>
    seg.map(([x, y], k) =>
      s === c.segs.length - 1 && k === 2 ? [x, y] : [x + dx, y],
    ),
  ) as unknown as Curve["segs"],
});

const f = (n: number) => Number(n.toFixed(3));
const toD = ({ m, segs }: Curve) =>
  `M${f(m[0])} ${f(m[1])}` +
  segs
    .map((seg) => `C${seg.map(([x, y]) => `${f(x)} ${f(y)}`).join(" ")}`)
    .join("");

/** Samples along the whole curve, x ascending. */
const sample = ({ m, segs }: Curve) => {
  const out: Pt[] = [];
  let p0: Pt = m;
  for (const [p1, p2, p3] of segs) {
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push([
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      ]);
    }
    p0 = p3;
  }
  return out;
};

const yAt = (pts: Pt[], x: number) => {
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= x) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    }
  }
  return pts[pts.length - 1][1];
};

/** Scan window (px either side of the resting centre) for each crossing. */
const WINDOW = 45;

/** Where the two curves cross near each marker (scan x, interpolate the sign change). */
const crossings = (a: Curve, b: Curve): Pt[] => {
  const sa = sample(a);
  const sb = sample(b);
  return MARKS.map((mark) => {
    let prevX = mark[0] - WINDOW;
    let prev = yAt(sa, prevX) - yAt(sb, prevX);
    for (let x = prevX + 1; x <= mark[0] + WINDOW; x++) {
      const diff = yAt(sa, x) - yAt(sb, x);
      if (Math.sign(diff) !== Math.sign(prev)) {
        const cx = prevX + prev / (prev - diff);
        return [cx, yAt(sa, cx)] as Pt;
      }
      prev = diff;
      prevX = x;
    }
    return mark;
  });
};

const BASE = crossings(RECOVERED, FAILED);

const draw = (v: number) => ({
  strokeDasharray: v >= 1 ? "none" : "1 1",
  strokeDashoffset: 1 - v,
  opacity: v > 0 ? 1 : 0,
});

/**
 * Failures vs recoveries: both lines draw in, then drift slowly in opposite
 * phase (4.8 s loop, only while in view) with the three crossing markers
 * gliding along their intersections. The 365 × 110 art scales with the widget
 * (253 wide at 1024, 290 at 768). Off screen everything rewinds to the
 * undrawn start.
 */
export const CurvesChart = ({
  label,
  delay = 0,
}: {
  label: string;
  delay?: number;
}) => {
  const [ref, seen, inView] = useSeen();
  const reduced = useReducedMotionPref();
  const drawn = useAfter(seen, delay + 1360);

  const { a, b, m } = useSpring({
    a: seen ? 1 : 0,
    b: seen ? 1 : 0,
    m: seen ? 1 : 0,
    delay: (key: string) => delay + (key === "b" ? 112 : key === "m" ? 720 : 0),
    immediate: !seen,
    config: SOFT_FAST,
  });

  const recovered = useRef<SVGPathElement>(null);
  const failed = useRef<SVGPathElement>(null);
  const markers = useRef<(SVGCircleElement | null)[]>([]);

  const onFrame = useCallback((elapsed: number) => {
    const dx = AMP * Math.sin((2 * Math.PI * elapsed) / PERIOD);
    const r = shift(RECOVERED, dx);
    const fl = shift(FAILED, -dx);
    recovered.current?.setAttribute("d", toD(r));
    failed.current?.setAttribute("d", toD(fl));
    crossings(r, fl).forEach(([cx, cy], k) =>
      markers.current[k]?.setAttribute(
        "transform",
        `translate(${f(cx - BASE[k][0])} ${f(cy - BASE[k][1])})`,
      ),
    );
  }, []);

  const rest = useCallback(() => onFrame(0), [onFrame]);
  useFrameLoop(drawn && inView && !reduced, onFrame, !seen, rest);

  return (
    <svg
      ref={ref}
      role="img"
      aria-label={label}
      width={365}
      height={110}
      viewBox="0 0 365 110"
      fill="none"
      className="absolute top-16.75 left-5.75 h-27.5 w-91.25 overflow-clip w1024:top-20.75 w1024:h-auto w1024:w-63.25 w768:top-16.75 w768:w-72.5"
    >
      <animated.path
        ref={recovered}
        d={RECOVERED_D}
        pathLength={1}
        strokeWidth={3}
        strokeLinecap="round"
        className="stroke-signals-curve-recovered"
        style={{
          strokeDasharray: a.to((v) => draw(v).strokeDasharray),
          strokeDashoffset: a.to((v) => draw(v).strokeDashoffset),
          opacity: a.to((v) => draw(v).opacity),
        }}
      />
      <animated.path
        ref={failed}
        d={FAILED_D}
        pathLength={1}
        strokeWidth={3}
        strokeLinecap="round"
        className="stroke-signals-curve-failed"
        style={{
          strokeDasharray: b.to((v) => draw(v).strokeDasharray),
          strokeDashoffset: b.to((v) => draw(v).strokeDashoffset),
          opacity: b.to((v) => draw(v).opacity),
        }}
      />
      {MARKS.map(([cx, cy], k) => (
        <animated.g
          key={cx}
          style={{
            opacity: m,
            transformOrigin: `${cx}px ${cy}px`,
            transform: m.to((v) =>
              v >= 1 ? "none" : `scale(${0.4 + 0.6 * v})`,
            ),
          }}
        >
          <circle
            ref={(el) => {
              markers.current[k] = el;
            }}
            cx={cx}
            cy={cy}
            r={5}
            strokeWidth={2}
            className="fill-signals-marker stroke-signals-curve-recovered"
          />
        </animated.g>
      ))}
    </svg>
  );
};
