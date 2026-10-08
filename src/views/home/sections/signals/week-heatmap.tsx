"use client";

import { animated, useSpring, useSprings } from "@react-spring/web";
import type { CSSProperties } from "react";

import type { SignalsContent, SignalsLoad } from "@/data/mocks/home/signals";
import { SPRING_SOFT } from "@/lib/motion";

import {
  useLoopPhase,
  useReducedMotionPref,
  useSeen,
} from "./use-signals-motion";

/** SPRING_SOFT ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SOFT_FAST = {
  tension: SPRING_SOFT.tension * 1.5,
  friction: SPRING_SOFT.friction * 1.22,
} as const;

const loadStyle = ([r, g, b, from, to]: SignalsLoad) =>
  ({
    "--signals-load-r": r,
    "--signals-load-g": g,
    "--signals-load-b": b,
    "--signals-load-from": from,
    "--signals-load-to": to,
  }) as CSSProperties;

const LOAD_GRADIENT =
  "bg-linear-to-r/srgb from-[rgb(var(--signals-load-r)_var(--signals-load-g)_var(--signals-load-b)/var(--signals-load-from))] to-[rgb(var(--signals-load-r)_var(--signals-load-g)_var(--signals-load-b)/var(--signals-load-to))]";

/** Softer than SPRING_SOFT so neighbouring cells overlap into one flow. */
const CELL_SPRING = { tension: 105, friction: 26.9 } as const;
/** Slow settle for the peak's glow (it rises and falls on one spring). */
const GLOW_SPRING = { tension: 33, friction: 15.9 } as const;
/** ms before the first cell (after the widget has started to rise). */
const START = 208;
/** ms between diagonals (mon/top → sun/bottom). */
const DIAG = 36;
/** Loop: wave + peak + rule (~2.2 s) → hold → soft diagonal fade out → again. */
const PLAY = 2240;
const LOOP = { hold: 2800, reset: 1200 } as const;
/** ms between diagonals while fading out (same direction, quicker). */
const FADE_DIAG = 20;

/** Day label brightening as the wave passes: soft rise, slower fall. */
const LABEL_UP = { tension: 135, friction: 29.4 } as const;
const LABEL_DOWN = { tension: 60, friction: 24.4 } as const;
/** ms the label holds at full brightness before easing back to rest. */
const LABEL_HOLD = 96;

/**
 * Cell look at progress v: fades up and grows from 0.92 → 1, resting = no
 * transform. No per-cell blur: 56 animated blur filters cost ~40ms a frame
 * while scrolling (measured); opacity + scale stay on the compositor.
 */
const scale = (v: number) => (v >= 1 ? "none" : `scale(${0.92 + 0.08 * v})`);

type Props = Pick<SignalsContent["week"], "days" | "today" | "todayPeak">;

/**
 * Heatmap columns — a soft continuous diagonal wave: every cell fades and
 * grows in on a long overlapping spring; today's lime peak settles last with
 * a glow that fades, then the today rule draws. Holds at the frame, fades
 * out along the same diagonal and plays again while on screen.
 */
export const WeekHeatmap = ({ days, today, todayPeak }: Props) => {
  const [ref, seen, inView] = useSeen();
  const { on } = useLoopPhase(seen, inView, { play: PLAY, ...LOOP });
  const rows = days[0].loads.length;
  const peakCol = days.findIndex((day) => day.label === today);
  const lastDiag = days.length - 1 + rows - 1;
  const peakDelay = START + (lastDiag + 2) * DIAG;

  const cells = useSprings(
    days.length * rows,
    Array.from({ length: days.length * rows }, (_, i) => {
      const c = Math.floor(i / rows);
      const r = i % rows;
      const isPeak = c === peakCol && r === todayPeak;
      return {
        t: on ? 1 : 0,
        delay: on
          ? isPeak
            ? peakDelay
            : START + (c + r) * DIAG
          : (c + r) * FADE_DIAG,
        immediate: !seen,
        config: CELL_SPRING,
      };
    }),
  );

  /*
   * Day labels: no typing caret (seven lime carets flickered in a row). Each
   * label fades in when the wave's bottom cell reaches its column, and on
   * every cycle a white copy over it breathes up and back to the Figma
   * colour at that same moment — a calm left→right shimmer, no lime.
   */
  const reduced = useReducedMotionPref();
  const labelAt = (c: number) => START + (c + rows - 1) * DIAG;
  const labels = useSprings(
    days.length,
    days.map((_, c) => ({
      o: seen ? 1 : 0,
      delay: seen ? labelAt(c) : 0,
      immediate: !seen || reduced,
      config: CELL_SPRING,
    })),
  );
  const shines = useSprings(
    days.length,
    days.map((_, c) =>
      on && !reduced
        ? {
            to: [
              { b: 1, delay: labelAt(c), config: LABEL_UP },
              { b: 0, delay: LABEL_HOLD, config: LABEL_DOWN },
            ],
            from: { b: 0 },
          }
        : { to: { b: 0 }, from: { b: 0 }, immediate: !seen || reduced },
    ),
  );

  const { g } = useSpring({
    g: on ? 1 : 0,
    delay: on ? peakDelay + 96 : 0,
    immediate: !on,
    config: GLOW_SPRING,
  });
  const { rule } = useSpring({
    rule: on ? 1 : 0,
    delay: on ? peakDelay + 336 : 0,
    immediate: !seen,
    config: SOFT_FAST,
  });

  return (
    <ul ref={ref} className="absolute top-16.25 left-15.75 flex gap-4 w1024:top-15.75 w1024:left-17.75 w1024:gap-2 w768:top-19.75 w768:left-21.5 w390:top-25.75 w390:left-11.75 w390:gap-1.25">
      {days.map((day, c) => {
        const isToday = c === peakCol;
        return (
          <li key={day.label} className="relative flex w-24.5 flex-col w1024:w-11.25 w768:w-19.75 w390:w-9">
            <div className="flex flex-col gap-0.75 w768:gap-1 w390:gap-0.75">
              {day.loads.map((load, r) => {
                const { t } = cells[c * rows + r];
                const style = {
                  opacity: t,
                  transform: t.to(scale),
                };
                return isToday && r === todayPeak ? (
                  <animated.span
                    key={r}
                    style={style}
                    className="relative h-3.5 rounded-signals-load w768:h-4 w390:h-3.5 bg-linear-to-r/srgb from-signals-load-today-from to-signals-load-today-to"
                  >
                    <animated.span
                      aria-hidden="true"
                      style={{
                        opacity: g.to((v) =>
                          v >= 1 ? 0 : Math.sin(Math.PI * v),
                        ),
                      }}
                      className="absolute inset-0 rounded-signals-load shadow-signals-glow"
                    />
                  </animated.span>
                ) : (
                  <animated.span key={r} style={style} className="h-3.5 w768:h-4 w390:h-3.5">
                    <span
                      style={loadStyle(load)}
                      className={`block h-3.5 rounded-signals-load w768:h-4 w390:h-3.5 ${LOAD_GRADIENT}`}
                    />
                  </animated.span>
                );
              })}
            </div>
            {isToday && (
              <animated.span
                aria-hidden="true"
                style={{
                  transform: rule.to((v) =>
                    v >= 1 ? "none" : `scaleX(${Math.max(v, 0)})`,
                  ),
                }}
                className="absolute top-34.75 left-0 block h-0.5 w-24.5 origin-left rounded-signals-rule bg-signals-today-rule w1024:w-11.25 w768:top-41 w768:w-19.75 w390:top-34.75 w390:w-9"
              />
            )}
            <animated.span
              style={{ opacity: labels[c].o }}
              className={`relative mt-3.25 font-mono w768:mt-4.5 w390:mt-4 text-label leading-label whitespace-nowrap w1024:text-center ${
                isToday ? "text-foreground-muted" : "text-foreground-dim"
              }`}
            >
              {day.label}
              <animated.span
                aria-hidden="true"
                style={{ opacity: shines[c].b }}
                className="absolute inset-0 text-foreground"
              >
                {day.label}
              </animated.span>
            </animated.span>
          </li>
        );
      })}
    </ul>
  );
};
