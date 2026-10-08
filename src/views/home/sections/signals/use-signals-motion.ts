"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useDynamicInView } from "@/hooks/animation/use-dynamic-in-view";
import { VIEW_MARGIN } from "@/lib/view";

/**
 * `seen` turns true once the node's widget is properly on screen (VIEW_MARGIN —
 * entrances start where the reader is looking) and false again once it has
 * left the screen entirely, so every visit replays from the first frame.
 * `inView` is plain visibility with no margin (pauses loops off-screen).
 */
export const useSeen = () => {
  const [seen, setSeen] = useState(false);
  const [setSeenNode] = useDynamicInView({
    rootMargin: VIEW_MARGIN,
    onEnter: () => setSeen(true),
  });
  const [setViewNode, inView] = useDynamicInView({
    onLeave: () => setSeen(false),
  });
  const setNode = useCallback(
    (node: Element | null) => {
      /* Start with the widget card, not the art inside it. */
      setSeenNode((node?.closest("article") ?? node) as HTMLElement | null);
      setViewNode(node as HTMLElement | null);
    },
    [setSeenNode, setViewNode],
  );
  return [setNode, seen, inView] as const;
};

/**
 * Loop phase for an illustration: `on` turns true once `seen`, stays for
 * `lead + play + hold` ms the first time, `play + hold` after (sequence plays, then rests at the Figma state), turns
 * false for `reset` ms (springs ease back), and so on. Timers run only while
 * `inView`; once `seen` drops (fully off screen) the loop rewinds to cycle 0,
 * so the next visit starts with the entrance again.
 * Reduced motion: `on` latches true — the static resting state.
 */
export const useLoopPhase = (
  seen: boolean,
  inView: boolean,
  {
    lead = 0,
    play,
    hold,
    reset,
  }: {
    /** Extra ms before the first play only (entrance stagger). */
    lead?: number;
    play: number;
    hold: number;
    reset: number;
  },
) => {
  const reduced = useReducedMotionPref();
  const [phase, setPhase] = useState<{ on: boolean; cycle: number }>({
    on: false,
    cycle: 0,
  });
  if (!seen && (phase.on || phase.cycle !== 0)) {
    setPhase({ on: false, cycle: 0 });
  }
  const on = seen && (phase.on || phase.cycle === 0);
  useEffect(() => {
    if (!seen || !inView || reduced) return;
    const id = window.setTimeout(
      () =>
        setPhase((p) =>
          p.on || p.cycle === 0
            ? { on: false, cycle: p.cycle + 1 }
            : { on: true, cycle: p.cycle },
        ),
      on ? (phase.cycle === 0 ? lead : 0) + play + hold : reset,
    );
    return () => window.clearTimeout(id);
  }, [seen, inView, reduced, on, phase.cycle, lead, play, hold, reset]);
  return { on: on || (seen && reduced), cycle: phase.cycle };
};

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Live `prefers-reduced-motion` (false on the server). */
export const useReducedMotionPref = () =>
  useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );

/** Flips true `ms` after `start` turns true; back to false with `start`. */
export const useAfter = (start: boolean, ms: number) => {
  const [done, setDone] = useState(false);
  if (!start && done) setDone(false);
  useEffect(() => {
    if (!start) return;
    const id = window.setTimeout(() => setDone(true), ms);
    return () => window.clearTimeout(id);
  }, [start, ms]);
  return start && done;
};

/**
 * rAF loop that runs only while `active`. `onFrame` receives the elapsed
 * running time in ms — it accumulates across pauses, so a loop resumes where
 * it stopped instead of jumping. While `rewind` is true the clock goes back
 * to 0 and `onRewind` puts the visual on its first frame.
 */
export const useFrameLoop = (
  active: boolean,
  onFrame: (elapsed: number) => void,
  rewind = false,
  onRewind?: () => void,
) => {
  const frame = useRef(onFrame);
  const reset = useRef(onRewind);
  const elapsed = useRef(0);
  useEffect(() => {
    frame.current = onFrame;
    reset.current = onRewind;
  });
  useEffect(() => {
    if (!rewind) return;
    elapsed.current = 0;
    reset.current?.();
  }, [rewind]);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      frame.current(elapsed.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
};
