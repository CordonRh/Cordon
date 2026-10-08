"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useState } from "react";

/**
 * Status dot that pulses: the dot swells and settles while a lime halo
 * expands out of it and fades, about every 1.8 s (motion brief, hero.status).
 *
 * The loop only starts once we know reduced motion is off: with react-spring's
 * global skipAnimation (set by <ReducedMotion />) a looping spring would finish
 * instantly and restart forever, locking the main thread.
 */
export const BreathingDot = () => {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPulse(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const dot = useSpring({
    from: { scale: 1 },
    to: pulse ? [{ scale: 1.35 }, { scale: 1 }, { scale: 1 }] : { scale: 1 },
    loop: pulse,
    config: { duration: 600 },
  });

  const halo = useSpring({
    from: { scale: 1, opacity: 0.8 },
    to: pulse
      ? [
          { scale: 3, opacity: 0 },
          { scale: 1, opacity: 0.8, immediate: true },
        ]
      : { scale: 1, opacity: 0 },
    loop: pulse,
    config: { duration: 1800 },
  });

  return (
    <span className="relative size-1.5 shrink-0">
      <animated.span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-accent"
        style={halo}
      />
      <animated.span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-accent"
        style={dot}
      />
    </span>
  );
};
