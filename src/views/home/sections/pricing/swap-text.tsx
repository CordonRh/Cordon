"use client";

import { animated, useTransition } from "@react-spring/web";

import { SPRING_SOFT } from "@/lib/motion";

/**
 * Text that changes with the slider: the old value softens out while the new
 * one focuses in on the same spot (one overlapped grid cell, so nothing
 * reflows). The first value renders plain — its entrance is the parent's.
 */
export const SwapText = ({ children }: { children: string }) => {
  const swap = useTransition(children, {
    initial: null,
    from: { opacity: 0, filter: "blur(6px)" },
    enter: { opacity: 1, filter: "blur(0px)" },
    leave: { opacity: 0, filter: "blur(6px)" },
    config: SPRING_SOFT,
  });

  return (
    <span className="inline-grid">
      {swap((style, text) => (
        <animated.span
          className="[grid-area:1/1]"
          style={{
            opacity: style.opacity,
            filter: style.filter.to((f) => (f === "blur(0px)" ? "none" : f)),
          }}
        >
          {text}
        </animated.span>
      ))}
    </span>
  );
};
