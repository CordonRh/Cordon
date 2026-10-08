"use client";

import { useEffect, useState } from "react";

/** Hover + press state for pointer devices that can actually hover. */
export const useHoverPress = () => {
  const [canHover, setCanHover] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setCanHover(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const handlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => {
      setHovered(false);
      setPressed(false);
    },
    onPointerDown: () => setPressed(true),
    onPointerUp: () => setPressed(false),
    onFocus: () => setHovered(true),
    onBlur: () => setHovered(false),
  };

  return { hovered: canHover && hovered, pressed, handlers };
};
