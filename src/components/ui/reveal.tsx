"use client";

import type { AriaAttributes, ReactNode } from "react";

import { InviewSeen } from "@/components/ui/inview-seen";
import { FADE, REVEAL, SPRING, SPRING_SOFT } from "@/lib/motion";
import type { Tags } from "@/types/springs";

export interface RevealProps extends AriaAttributes {
  children?: ReactNode;
  tag?: Tags;
  /** `rise` — 24 up + fade. `fade` — opacity only. */
  variant?: "rise" | "fade";
  /** Delay before playing, ms (use `i * REVEAL.step` for staggers). */
  delay?: number;
  className?: string;
  id?: string;
}

const PRESET = {
  rise: { ...REVEAL, config: SPRING },
  fade: { ...FADE, config: SPRING_SOFT },
} as const;

/**
 * Once-only scroll reveal for Server Components to wrap their blocks in.
 * Rise uses the page spring; fade uses the softer one so it reads as a fade.
 */
export const Reveal = ({
  children,
  tag = "div",
  variant = "rise",
  delay = 0,
  ...props
}: RevealProps) => {
  const preset = PRESET[variant];
  return (
    <InviewSeen
      tag={tag}
      mode="once"
      from={preset.from}
      to={preset.to}
      config={preset.config}
      delayIn={delay}
      {...props}
    >
      {children}
    </InviewSeen>
  );
};
