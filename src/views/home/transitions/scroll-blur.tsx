"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useRef, type ReactNode } from "react";

import { subscribeToTicker } from "@/lib/animation/ticker";
import { readScrollY } from "@/lib/scroll-y";
import { SPRING } from "@/lib/motion";

/** Drift, px: the block rises in from below and leaves upward by this much. */
const DRIFT = 48;
const ENTER_FROM = 0.6;
const LEAVE_TO = 0.25;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * "Soft handoff" between blocks (motion brief, transitions t2 t5 t6 t7):
 * the outgoing block fades and drifts up while the incoming one fades in from
 * below — both scrubbed by scroll. No blur any more (client call): content
 * went soft under the header and read as a late entrance.
 *
 * `enter`: fully in by the time the block's top reaches the viewport centre.
 * `leave`: fades once the block's bottom passes the centre.
 *
 * Progress comes from the scroll position (readScrollY — Lenis's number,
 * never a layout read) against the wrapper's document offset, measured once
 * and again only when the layout changes — not from a rect read every
 * frame. These wrap whole sections, so several are on screen at once, and
 * their per-frame rect reads were the single largest JS cost of a scrolled
 * frame (ADR-0027). The spring (SPRING) follows the scrubbed target
 * exactly as SpringTrigger's did; the loop runs only while the block is on
 * screen.
 */
export const ScrollBlur = ({
  children,
  enter = false,
  leave = false,
  still = false,
}: {
  children: ReactNode;
  enter?: boolean;
  leave?: boolean;
  /** No drift, only the fade — for a block whose edge lines up with the
   *  page backdrop. */
  still?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [springs, api] = useSpring(() => ({
    opacity: 1,
    y: 0,
    config: SPRING,
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el || (!enter && !leave)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const drift = still ? 0 : DRIFT;
    let docTop = 0;
    let height = 0;
    let vh = 1;
    let last = Number.NaN;
    let stop: (() => void) | null = null;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      docTop = rect.top + window.scrollY;
      height = rect.height;
      vh = window.innerHeight;
    };

    const frame = () => {
      const top = docTop - readScrollY();
      const bottom = top + height;
      let opacity = 1;
      let y = 0;
      if (enter) {
        // 0 with the top at the viewport's bottom, 1 with it at the centre
        const p = clamp((vh - top) / (vh / 2));
        opacity *= mix(ENTER_FROM, 1, p);
        y += mix(drift, 0, p);
      }
      if (leave) {
        // 0 with the bottom at the centre, 1 with it at the viewport's top
        const p = clamp((vh / 2 - bottom) / (vh / 2));
        opacity *= mix(1, LEAVE_TO, p);
        y += mix(0, -drift, p);
      }
      const key = opacity * 1e4 + y;
      if (key === last) return;
      last = key;
      api.start({ opacity, y });
    };

    const run = (on: boolean) => {
      if (on && !stop) {
        measure();
        stop = subscribeToTicker(frame, () => 0);
      } else if (!on && stop) {
        stop();
        stop = null;
        frame(); // settle on the value past the edge
      }
    };

    const io = new IntersectionObserver(([entry]) => run(entry.isIntersecting));
    io.observe(el);
    const layout = new ResizeObserver(() => {
      measure();
      if (stop) frame();
    });
    layout.observe(el);
    const main = el.closest("main");
    if (main) layout.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      stop?.();
      io.disconnect();
      layout.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [api, enter, leave, still]);

  return (
    <div ref={ref}>
      <animated.div style={springs}>{children}</animated.div>
    </div>
  );
};
