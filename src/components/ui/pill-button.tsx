import type { ReactNode } from "react";

import { GlassButton } from "./glass-button";
import { LimeCta } from "./lime-cta";

export interface PillButtonProps {
  href: string;
  children: ReactNode;
  /** `primary` — lime fill. `glass` — translucent gradient with a hairline. */
  variant?: "primary" | "glass";
  /** `md` — 40 tall, 14 type (nav). `lg` — 48 tall, 16 type (hero). */
  size?: "md" | "lg";
  className?: string;
}

const SIZE = {
  md: "h-10 px-6 text-label leading-label",
  lg: "h-12 px-6 text-body leading-body",
} as const;

/** Pill CTA — component instance 2726:25 (nav 3488:21054, hero 3488:21935). */
export const PillButton = ({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: PillButtonProps) =>
  variant === "primary" ? (
    <LimeCta
      href={href}
      label={String(children)}
      className={`${SIZE[size]} ${className}`}
    />
  ) : (
    <GlassButton href={href} className={`${SIZE[size]} ${className}`}>
      {children}
    </GlassButton>
  );
