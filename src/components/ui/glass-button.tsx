"use client";

import { animated, easings, useSpring } from "@react-spring/web";
import Link from "@/components/compat/link";

const AnimatedLink = animated(Link);
import type { CSSProperties, ReactNode } from "react";

import { SPRING_SOFT } from "@/lib/motion";

import { useHoverPress } from "./use-hover-press";

export interface GlassButtonProps {
  href: string;
  children: ReactNode;
  className?: string;
}

/**
 * Glass pill — on hover a brighter stroke runs once around the pill, clockwise
 * from the top (motion brief, shared.glass: "the outline fills around the circle").
 * The base 22% hairline stays underneath; the fill is a conic ring on top,
 * painted over the border box — the pill must not clip its overflow, or the
 * ring (which sits on the 1px border) is cut away.
 */
export const GlassButton = ({
  href,
  children,
  className = "",
}: GlassButtonProps) => {
  const { hovered, pressed, handlers } = useHoverPress();
  /* the stroke travels round in 1.1 s; it retracts faster on leave */
  const { p } = useSpring({
    p: hovered ? 100 : 0,
    config: { duration: hovered ? 1100 : 450, easing: easings.easeInOutCubic },
  });
  const { s } = useSpring({ s: pressed ? 0.97 : 1, config: SPRING_SOFT });

  return (
    <AnimatedLink
      href={href}
      style={{ scale: s }}
      className={`relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-border-glass backdrop-blur-glass bg-linear-to-b/srgb from-glass-from to-glass-to font-medium whitespace-nowrap text-foreground shadow-float ${className}`}
      {...handlers}
    >
      <animated.span
        aria-hidden="true"
        className="stroke-ring pointer-events-none absolute -inset-px rounded-full bg-[conic-gradient(from_0deg,var(--glass-stroke-active)_var(--fill),transparent_var(--fill))]"
        style={{ "--fill": p.to((v) => `${v}%`) } as CSSProperties}
      />
      {children}
    </AnimatedLink>
  );
};
