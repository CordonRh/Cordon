"use client";

import { InviewSeen } from "@/components/ui/inview-seen";
import { SPRING_SOFT } from "@/lib/motion";

/**
 * Hairline that draws itself from the left edge when it enters the viewport
 * (motion brief, shared.hairlines). Pass the line's own size, position and
 * colour classes.
 */
export const DrawLine = ({
  className = "",
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) => (
  <InviewSeen
    tag="span"
    mode="once"
    aria-hidden="true"
    className={`block origin-left ${className}`}
    from={{ scaleX: 0 }}
    to={{ scaleX: 1 }}
    config={SPRING_SOFT}
    delayIn={delay}
  />
);
