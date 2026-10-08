"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useState } from "react";

const INTERACTIVE =
  "a, button, input, textarea, select, label, [role='button'], [role='radio'], [role='slider']";

/** The ring at rest, over something interactive, and its press squeeze. */
const RING = 28;
const RING_OVER = 44;
const PRESS = 0.82;
/** The follow lag: a soft spring, so the ring glides after the pointer. */
const FOLLOW = { tension: 210, friction: 24, mass: 1 } as const;
const SHAPE = { tension: 400, friction: 30 } as const;
const OFFSCREEN = { x: -200, y: -200 };

/**
 * Lime cursor ring (motion brief, character.cursor). The native cursor stays;
 * this lime ring glides after it on a soft spring, opens up over anything
 * interactive, squeezes on press and steps aside over `[data-cursor="none"]`
 * (elements with their own hover story). Fine pointers only — on touch
 * devices and under reduced motion it never mounts.
 *
 * The pointer position is written straight into the spring from the event
 * (no React state, so a move never re-renders); only the hover / press /
 * hidden flags go through state, and only when they change.
 */
export const CursorDot = () => {
  const [enabled, setEnabled] = useState(false);
  const [over, setOver] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [down, setDown] = useState(false);
  const [follow, api] = useSpring(() => ({
    ...OFFSCREEN,
    config: FOLLOW,
  }));

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduce.matches) return;
    setEnabled(true);
    let seen = false;
    let wasOver = false;
    let wasHidden = false;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      // the first move places the ring on the pointer; every later one glides
      api.start({ x: e.clientX, y: e.clientY, immediate: !seen });
      seen = true;
      const target = e.target as Element | null;
      const isOver = !!target?.closest?.(INTERACTIVE);
      if (isOver !== wasOver) {
        wasOver = isOver;
        setOver(isOver);
      }
      const isHidden = !!target?.closest?.("[data-cursor='none']");
      if (isHidden !== wasHidden) {
        wasHidden = isHidden;
        setHidden(isHidden);
      }
    };
    const press = () => setDown(true);
    const release = () => setDown(false);
    const leave = () => {
      seen = false;
      api.start({ ...OFFSCREEN, immediate: true });
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [api]);

  const shape = useSpring({
    size: over ? RING_OVER : RING,
    fill: over ? 0.12 : 0,
    press: hidden ? 0 : down ? PRESS : 1,
    config: SHAPE,
  });

  if (!enabled) return null;
  return (
    <animated.div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-50 rounded-full border border-accent will-change-transform"
      style={{
        x: follow.x,
        y: follow.y,
        width: shape.size,
        height: shape.size,
        translateX: "-50%",
        translateY: "-50%",
        scale: shape.press,
      }}
    >
      <animated.span
        className="absolute inset-0 rounded-full bg-accent"
        style={{ opacity: shape.fill }}
      />
    </animated.div>
  );
};
