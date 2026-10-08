"use client";

import { animated, useSpring, useSprings } from "@react-spring/web";
import Image from "@/components/compat/image";
import { useEffect, useRef } from "react";

import type { ProductContent } from "@/data/mocks/home/product";
import { SPRING, SPRING_SOFT } from "@/lib/motion";

import { CARD } from "./feature-row";
import { CARD_START } from "./use-card-play";
import { useLoopCycle } from "./use-loop-cycle";

/**
 * Per-step positions inside the card's padding box (Visual 3888:5827).
 * Rows step 42 from label y91; spans sit on the 0–200 ms axis at x223.
 *
 * The 1024 card (3888:10234) redraws the same run inside 528 × 324: padding
 * 24, rules 44 apart from y111, every span on the axis at x189 and scaled
 * 0.695, and the tick icon sits 4 below its label instead of beside it.
 * 768 (3849:2) is the 1024 card 321 tall: rows 45 apart from label y76.
 * 390 (3893:3101): 350 × 249, 12/18 mono, rows 35 apart from y64, 7px icons,
 * spans from x146 (the 1 ms span is dropped).
 */
const STEP_LAYOUT = [
  {
    icon: "top-23 w1024:top-20.75 w768:top-20 w390:top-17.5",
    label: "top-22.75 w1024:top-19.75 w768:top-19 w390:top-16",
    value: "top-23 w1024:top-19.75 w768:top-19 w390:top-16",
    span: "top-23.75 left-55.75 w-57 w1024:top-21.25 w1024:left-47.25 w1024:w-39.5 w768:top-20.5 w390:top-[calc(var(--spacing)*17.625)] w390:left-36.5 w390:w-25.5 bg-linear-to-r/srgb from-product-span-from to-accent",
  },
  {
    icon: "top-33.5 w1024:top-31.75 w768:top-31.25 w390:top-26.25",
    label: "top-33.25 w1024:top-30.75 w768:top-30.25 w390:top-24.75",
    value: "top-33.5 w1024:top-30.75 w768:top-30.25 w390:top-24.75",
    span: "top-34.25 left-112.75 w-3.75 w1024:top-32.25 w1024:left-47.25 w1024:w-2.5 w768:top-31.75 w390:top-[calc(var(--spacing)*26.375)] w390:left-37.25 w390:w-1.75 bg-product-span-short",
  },
  {
    icon: "top-44 w1024:top-42.75 w768:top-42.5 w390:top-35",
    label: "top-43.75 w1024:top-41.75 w768:top-41.5 w390:top-33.5",
    value: "top-44 w1024:top-41.75 w768:top-41.5 w390:top-33.5",
    span: "top-44.75 left-116.5 w-1.5 w1024:top-43.25 w1024:left-47.25 w1024:w-1 w390:hidden bg-product-span-short",
  },
  {
    icon: "top-54.5 w1024:top-53.75 w768:top-53.75 w390:top-43.75",
    label: "top-54.25 w1024:top-52.75 w768:top-52.75 w390:top-42.25",
    value: "top-54.5 w1024:top-52.75 w768:top-52.75 w390:top-42.25",
    span: "top-55.25 left-117 w-15 w1024:top-54.25 w1024:left-47.25 w1024:w-10.5 w390:top-[calc(var(--spacing)*43.875)] w390:left-36.5 w390:w-6.75",
  },
] as const;

/** Rules between steps (3888:5834, 5838, 5842; 1024 3888:10241 → 10249; 768 3849:9 → 17; 390 3893:3129 → 3145). */
const RULES = [
  "top-30.25 w1024:top-27.75 w768:top-27 w390:top-22.5",
  "top-40.75 w1024:top-38.75 w768:top-38.25 w390:top-31.25",
  "top-51.25 w1024:top-49.75 w768:top-49.5 w390:top-40",
] as const;

/** Axis ticks at 0 / 50 / 100 / 150 / 200 ms (3888:5847 → 5855; 1024 3888:10254 → 10262; 390 Union 3893:3112). */
const TICKS = [
  "left-55.75 w1024:left-47.25 w390:left-37.25",
  "left-79.5 w1024:left-61 w390:left-48.5",
  "left-103.25 w1024:left-74.75 w390:left-59.75",
  "left-127 w1024:left-88.25 w390:left-71",
  "left-150.75 w1024:left-102 w390:left-82",
] as const;
/** Axis label centres — on the ticks, except 390 keeps only 0 / 100 / 200 ms, set off their ticks. */
const TICK_LABELS = [
  "left-55.75 w1024:left-47.25 w390:left-38.5",
  "left-79.5 w1024:left-61 w390:hidden",
  "left-103.25 w1024:left-74.75 w390:left-[calc(var(--spacing)*60.125)]",
  "left-127 w1024:left-88.25 w390:hidden",
  "left-150.75 w1024:left-102 w390:left-[calc(var(--spacing)*77.125)]",
] as const;

/** Card chrome and the two hairline widths, 1440 then 1024 / 768, then 390. */
const RULE_LINE =
  "absolute left-7.75 h-px w-174 w1024:left-5.75 w1024:w-120 w390:left-4.75 w390:w-77.5";
const ICON_SIZE = "size-4 w1024:size-2.75 w390:size-1.75";

const MONO = "font-mono text-product-small leading-product-small";

/** When each span starts growing, ms after the card enters view — a run in order. */
const SPAN_AT = [120, 520, 680, 800].map((t) => CARD_START + t);
/** The check draws once its span has mostly grown. */
const CHECK_AFTER = 240;
/** Dash + gap of the pending span's border, px; the dashes crawl one period per `CRAWL_MS`. */
const DASH = 3;
const GAP = 4;
const CRAWL_MS = 1120;
/** The summary types in after the last span, one character per this many ms. */
const SUMMARY_AT = SPAN_AT[3] + 360;
const TYPE_PER = 24;

const splitValue = (value: string) => {
  const match = /^(\d+)(.*)$/.exec(value);
  return match ? { n: Number(match[1]), unit: match[2] } : null;
};

/**
 * Row 01 trace card — "Waterfall" (motion brief, product.trace): spans grow from
 * their left edge one after another, ms values count up with them, checks
 * draw, the pending span's dashes crawl while in view; run / summary type in.
 */
export const TraceCard = ({ trace }: Pick<ProductContent, "trace">) => {
  const { ref, on, visible, reduced, snap } = useLoopCycle(
    SUMMARY_AT + trace.summary.length * TYPE_PER + 240,
  );
  const dashRef = useRef<SVGRectElement>(null);

  const [springs] = useSprings(
    trace.steps.length,
    (i) => ({
      from: { grow: 0, n: 0, draw: 1 },
      to: on
        ? { grow: 1, n: splitValue(trace.steps[i].value)?.n ?? 0, draw: 0 }
        : { grow: 0, n: 0, draw: 1 },
      config: (key: string) => (key === "draw" ? SPRING : SPRING_SOFT),
      // Reset runs the waterfall back, last span first.
      delay: (key: string) =>
        !on
          ? (trace.steps.length - 1 - i) * 48
          : SPAN_AT[i] + (key === "draw" ? CHECK_AFTER : 0),
      immediate: snap,
    }),
    [on, snap],
  );
  const [runTyped] = useSpring(
    () => ({
      from: { c: 0 },
      to: { c: on ? trace.run.length : 0 },
      delay: on ? CARD_START : 0,
      config: on
        ? { duration: trace.run.length * TYPE_PER }
        : { duration: 200 },
      immediate: snap,
    }),
    [on, snap],
  );
  const [typed] = useSpring(
    () => ({
      from: { c: 0 },
      to: { c: on ? trace.summary.length : 0 },
      delay: on ? SUMMARY_AT : 0,
      config: on
        ? { duration: trace.summary.length * TYPE_PER }
        : { duration: 200 },
      immediate: snap,
    }),
    [on, snap],
  );

  // Dash crawl: only while the card is on screen, never under reduced motion.
  useEffect(() => {
    const rect = dashRef.current;
    if (!visible || reduced || !rect) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) % CRAWL_MS) / CRAWL_MS;
      rect.style.strokeDashoffset = String(-t * (DASH + GAP));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [visible, reduced]);

  return (
    <figure
      ref={ref}
      className={`${CARD} h-82 w1024:h-81 w768:h-80.25 w390:h-62.25`}
    >
      <p
        className={`absolute top-8.25 left-7.75 whitespace-nowrap text-foreground w1024:top-5.75 w1024:left-5.75 w390:top-4.75 w390:left-4.75 ${MONO}`}
      >
        <span className="sr-only">{trace.run}</span>
        <span aria-hidden="true" className="relative">
          <animated.span>
            {runTyped.c.to((c) => trace.run.slice(0, Math.round(c)))}
          </animated.span>
          <animated.span className="text-transparent">
            {runTyped.c.to((c) => trace.run.slice(Math.round(c)))}
          </animated.span>
        </span>
      </p>
      <p
        className={`absolute top-8.25 right-8.25 w-70 text-right text-foreground-dim w1024:top-5.75 w1024:right-5.75 w1024:w-39 w390:top-4.75 w390:right-4.75 w390:w-33.5 ${MONO}`}
      >
        <span className="sr-only">{trace.summary}</span>
        <span aria-hidden="true" className="relative">
          <animated.span>
            {typed.c.to((c) => trace.summary.slice(0, Math.round(c)))}
          </animated.span>
          <animated.span className="text-transparent">
            {typed.c.to((c) => trace.summary.slice(Math.round(c)))}
          </animated.span>
        </span>
      </p>
      <span className="absolute top-15.75 left-7.75 h-px w-174 bg-product-card-border w1024:top-13.75 w1024:left-5.75 w1024:w-120 w390:top-12.25 w390:left-4.75 w390:w-77.5" />

      {RULES.map((top) => (
        <span
          key={top}
          className={`${RULE_LINE} bg-product-trace-rule ${top}`}
        />
      ))}

      <ul>
        {trace.steps.map((step, i) => {
          const layout = STEP_LAYOUT[i];
          const spring = springs[i];
          const count = splitValue(step.value);
          return (
            <li key={step.label}>
              {step.done ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  overflow="visible"
                  className={`absolute left-7.75 w1024:left-5.75 w390:left-4.75 ${ICON_SIZE} ${layout.icon}`}
                >
                  <animated.path
                    d="M3.5 8.5L6.5 11.5L12.5 4.5"
                    className="stroke-foreground-muted"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={spring.draw}
                    opacity={spring.draw.to((d) => (d < 1 ? 1 : 0))}
                  />
                </svg>
              ) : (
                <animated.span
                  className={`absolute left-7.75 w1024:left-5.75 w390:left-4.75 ${ICON_SIZE} ${layout.icon}`}
                  style={{ opacity: spring.grow.to((g) => Math.min(1, g)) }}
                >
                  <Image
                    src="/assets/product/product-icon-clock.svg"
                    alt=""
                    width={16}
                    height={16}
                    className={`block ${ICON_SIZE}`}
                  />
                </animated.span>
              )}
              <span
                className={`absolute left-14.75 whitespace-nowrap w1024:left-11.25 w390:left-8.25 ${MONO} ${step.done ? "text-foreground" : "text-foreground-muted"} ${layout.label}`}
              >
                {step.label}
              </span>
              {step.done ? (
                <animated.span
                  className={`absolute h-3 origin-left rounded-product-span w1024:h-2 w390:h-1.25 ${layout.span}`}
                  style={{ transform: spring.grow.to((g) => `scaleX(${g})`) }}
                />
              ) : (
                <animated.svg
                  aria-hidden="true"
                  viewBox="0 0 60 12"
                  className={`absolute h-3 origin-left w1024:h-2 w390:h-1.25 ${layout.span}`}
                  style={{ transform: spring.grow.to((g) => `scaleX(${g})`) }}
                >
                  <rect
                    ref={dashRef}
                    x={0.5}
                    y={0.5}
                    width={59}
                    height={11}
                    rx={3.5}
                    className="fill-product-pending stroke-product-pending-border"
                    strokeDasharray={`${DASH} ${GAP}`}
                  />
                </animated.svg>
              )}
              <animated.span
                className={`absolute right-8.25 w-30 text-right text-foreground-dim w1024:right-5.75 w1024:w-16 w390:right-4.75 w390:w-13 ${MONO} ${layout.value}`}
                style={
                  count
                    ? undefined
                    : { opacity: spring.grow.to((g) => Math.min(1, g)) }
                }
              >
                {count
                  ? spring.n.to((v) => `${Math.round(v)}${count.unit}`)
                  : step.value}
              </animated.span>
            </li>
          );
        })}
      </ul>

      <span className="absolute top-65.75 left-55.75 h-px w-95 bg-product-hairline w1024:top-67.75 w1024:left-47.25 w1024:w-55 w768:top-67 w390:top-50 w390:left-37.25 w390:w-45" />
      {trace.axis.map((tick, i) => (
        <span key={tick}>
          <span
            className={`absolute top-66 h-1.25 w-px bg-product-tick w1024:top-68 w1024:h-0.75 w768:top-67.25 w390:top-50.25 w390:h-0.5 ${TICKS[i]}`}
          />
          <span
            className={`absolute top-68.25 w-15 -translate-x-1/2 text-center text-foreground-dim w1024:top-69.75 w768:top-69 w390:top-52.5 ${MONO} ${TICK_LABELS[i]}`}
          >
            {tick}
          </span>
        </span>
      ))}
    </figure>
  );
};
