"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { SPRING } from "@/lib/motion";

/**
 * Nav pinned to the top while scrolling (user: always visible). At the very
 * top it is the transparent Figma nav; once it has scrolled past its own
 * height (88 / 64 / 56 per frame) it gets a blurred dark plate so it stays
 * readable over the lime Statement.
 */
export const NavShell = ({ children }: { children: ReactNode }) => {
  const [atTop, setAtTop] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () =>
      setAtTop(window.scrollY < (ref.current?.offsetHeight ?? 0));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const s = useSpring({ plate: atTop ? 0 : 1, config: SPRING });

  return (
    <div ref={ref} className="fixed inset-x-0 top-0 z-40">
      <animated.div
        aria-hidden="true"
        className="absolute inset-0 bg-nav-surface-scrolled backdrop-blur-nav"
        style={{ opacity: s.plate }}
      />
      {children}
    </div>
  );
};
