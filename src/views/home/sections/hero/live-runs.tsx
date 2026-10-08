"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useState } from "react";

import { Reveal } from "@/components/ui/reveal";
import { useDynamicInView } from "@/hooks/animation/use-dynamic-in-view";
import { pick, useFrame } from "@/hooks/use-frame";
import { SPRING, STEP } from "@/lib/motion";

import { LIVE, LOAD } from "./timeline";
/** First screen: start as soon as it is visible, not at the VIEW_MARGIN line. */
const HERO_MARGIN = "0px";

export interface Run {
  time: string;
  name: string;
  duration: string;
  live: boolean;
}

export interface LiveRunsProps {
  runs: readonly Run[];
  /** Name / duration pairs the live feed cycles through. */
  pool: readonly { name: string; duration: string }[];
  /** Seconds between consecutive run timestamps, cycled. */
  gaps: readonly number[];
}

const toSeconds = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};
const toTime = (sec: number) =>
  [Math.floor(sec / 3600) % 24, Math.floor(sec / 60) % 60, sec % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

const RowCells = ({ run, live }: { run: Run; live: React.ReactNode }) => (
  <>
    {live}
    <span className="absolute top-0.25 left-5 text-foreground-dim w1024:top-0 w1024:left-4.5">
      {run.time}
    </span>
    <span className="absolute top-0 left-27.5 text-foreground-muted w1024:left-25">
      {run.name}
    </span>
    <span className="absolute top-0.25 right-0 text-right text-foreground-dim w1024:top-0">
      {run.duration}
    </span>
  </>
);

const Dot = ({ live }: { live: boolean }) => (
  <span
    aria-hidden
    className={`absolute top-2 left-0 size-1.5 rounded-full w1024:top-1.75 ${live ? "bg-hero-run-live" : "bg-hero-run-idle"}`}
  />
);

/** One shift: the new run slides into the top, the rest move down a row. */
const Shift = ({ rows }: { rows: Run[] }) => {
  const { p } = useSpring({ from: { p: 0 }, to: { p: 1 }, config: SPRING });
  const pitch = pick(useFrame(), {
    1440: LIVE.rowPitch,
    1024: LIVE.rowPitch1024,
  });
  return (
    <>
      {rows.map((run, i) => (
        <animated.li
          key={run.time}
          aria-hidden={i === 3 || undefined}
          className="absolute inset-x-0 top-0 h-5.25 w1024:h-5"
          style={{
            transform: p.to((v) => `translateY(${(i - 1 + v) * pitch}rem)`),
            opacity: i === 0 ? p : i === 3 ? p.to((v) => 1 - v) : 1,
          }}
        >
          <RowCells
            run={run}
            live={
              i === 1 ? (
                <>
                  <Dot live={false} />
                  <animated.span
                    aria-hidden
                    className="absolute top-2 left-0 size-1.5 rounded-full bg-hero-run-live w1024:top-1.75"
                    style={{ opacity: p.to((v) => 1 - v) }}
                  />
                </>
              ) : (
                <Dot live={i === 0} />
              )
            }
          />
        </animated.li>
      ))}
    </>
  );
};

/**
 * "last runs" — the Figma rows at rest (768 / 390 show only the newest: the
 * list is one row tall and the shift is clipped to it); while in view a new run slides into
 * the top every LIVE.runEvery and pushes the others down (3 stay visible).
 */
export const LiveRuns = ({ runs, pool, gaps }: LiveRunsProps) => {
  const [setNode, inView] = useDynamicInView({ rootMargin: HERO_MARGIN });
  const [{ feed, n }, setState] = useState(() => ({ feed: [...runs], n: 0 }));

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setState((prev) => {
        const next = pool[prev.n % pool.length];
        const time = toTime(
          toSeconds(prev.feed[0].time) + gaps[prev.n % gaps.length],
        );
        return {
          feed: [{ ...next, time, live: true }, ...prev.feed].slice(0, 4),
          n: prev.n + 1,
        };
      });
    }, LIVE.runEvery);
    return () => window.clearInterval(id);
  }, [inView, pool, gaps]);

  return (
    <ul
      ref={setNode}
      className={`absolute top-123.5 left-9.75 h-22.25 w-150 font-mono text-label leading-label whitespace-nowrap w1024:top-139.5 w1024:left-5.75 w1024:h-19 w1024:w-117 w768:top-136.25 w768:h-5 w390:top-120 w390:left-4.75 w390:w-77.5 ${n > 0 ? "[clip-path:inset(0_-1rem_0_-1rem)]" : ""}`}
    >
      {n === 0 ? (
        runs.map((run, i) => (
          <Reveal
            key={run.time}
            tag="li"
            variant="fade"
            delay={LOAD.runs + i * STEP}
            className={`absolute inset-x-0 h-5.25 w1024:h-5 ${["top-0", "top-8.5 w1024:top-7 w768:hidden", "top-17 w1024:top-14 w768:hidden"][i]}`}
          >
            <RowCells run={run} live={<Dot live={run.live} />} />
          </Reveal>
        ))
      ) : (
        <Shift key={n} rows={feed} />
      )}
    </ul>
  );
};
