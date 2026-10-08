"use client";

import { animated, useSpring } from "@react-spring/web";
import Link from "@/components/compat/link";
import { useState, type MouseEvent, type ReactNode } from "react";

import { useHoverPress } from "@/components/ui/use-hover-press";
import { SPRING, SPRING_SOFT } from "@/lib/motion";

const AnimatedLink = animated(Link);

type Side = "left" | "right";

/** Side of the pill the pointer crossed — the fill grows from / retracts to it. */
const sideOf = (event: MouseEvent<HTMLElement>): Side => {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left + box.width / 2 ? "left" : "right";
};

/** Pill clip for a fill `v` (0 → 1) anchored on `side`. */
const clip = (side: Side, v: number) => {
  const rest = `${(1 - Math.min(1, Math.max(0, v))) * 100}%`;
  return side === "left"
    ? `inset(0 ${rest} 0 0 round 999px)`
    : `inset(0 0 0 ${rest} round 999px)`;
};

/**
 * Tier glass button (3488:22827) — Figma's flat 7% fill with a 16% hairline,
 * not the shared gradient GlassButton. On hover the pill fills with lime: the
 * accent layer grows in from the side the pointer entered on a spring, and the
 * label turns on-accent ink exactly under the fill edge (the fill carries its
 * own ink copy of the label, centred on the same line), so it stays readable.
 * Leaving retracts the fill toward the exit side. No stroke, and the
 * lime cursor steps aside (data-cursor) so no ring sits on the fill. A press squashes it. At rest nothing but the Figma pill shows.
 */
export const GlassTierButton = ({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) => {
  const { hovered, pressed, handlers } = useHoverPress();
  const [side, setSide] = useState<Side>("left");
  const { f } = useSpring({ f: hovered ? 1 : 0, config: SPRING_SOFT });
  const { s } = useSpring({ s: pressed ? 0.97 : 1, config: SPRING });
  const clipPath = f.to((v) => clip(side, v));

  return (
    <AnimatedLink
      data-cursor="none"
      href={href}
      style={{ scale: s }}
      className={`flex h-12 items-center justify-center rounded-full border border-pricing-button-border bg-pricing-button text-body leading-body font-medium whitespace-nowrap text-pricing-button-text w1024:h-15 ${className}`}
      {...handlers}
      onMouseEnter={(event) => {
        setSide(sideOf(event));
        handlers.onMouseEnter();
      }}
      onMouseLeave={(event) => {
        setSide(sideOf(event));
        handlers.onMouseLeave();
      }}
    >
      <span className="relative">{children}</span>
      <animated.span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px flex items-center justify-center rounded-full bg-accent text-on-accent"
        style={{ clipPath }}
      >
        {children}
      </animated.span>
    </AnimatedLink>
  );
};
