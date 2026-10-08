"use client";

import { animated, useSpring } from "@react-spring/web";

import { LimeCta } from "@/components/ui/lime-cta";
import { SPRING } from "@/lib/motion";

/**
 * Team card button — the shared LimeCta untouched, so its hover is the nav
 * "Start free" one exactly. Figma's lime glow is a separate layer
 * behind it that fades out while the pill is hovered, so nothing extra shows
 * round the inverted ink pill.
 */
/** The Team card's own button box (1440 / 1024 / 768 / 390). */
export const TEAM_CTA_BOX =
  "absolute top-79.25 right-7.75 left-7.75 h-12 w1024:top-87.25 w1024:right-5.75 w1024:left-5.75 w1024:h-15 w768:top-59.5 w768:h-12 w390:top-84.5 w390:right-4.75 w390:left-4.75 w390:h-15";

export const TeamCta = ({
  href,
  label,
  className = TEAM_CTA_BOX,
}: {
  href: string;
  label: string;
  /** Position/size box — defaults to the Team card's. */
  className?: string;
}) => {
  const [{ g }, api] = useSpring(() => ({ g: 1, config: SPRING }));

  return (
    <div
      className={className}
      onMouseEnter={() => api.start({ g: 0 })}
      onMouseLeave={() => api.start({ g: 1 })}
    >
      <animated.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full shadow-pricing-button-glow"
        style={{ opacity: g }}
      />
      <LimeCta
        href={href}
        label={label}
        className="size-full text-body leading-body"
      />
    </div>
  );
};
