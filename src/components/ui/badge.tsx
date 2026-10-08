import { PulseDot } from "./pulse-dot";

export interface BadgeProps {
  label: string;
  className?: string;
}

/**
 * Section badge — lime dot + label in a pill (04 Product 3488:21993; the same
 * badge heads 06, 07, 08 and 09). The narrower frames pad it to 36 tall: 8 top
 * and bottom, 12 left, 16 right, the 1px stroke drawn inside that padding.
 */
export const Badge = ({ label, className = "" }: BadgeProps) => (
  <span
    className={`inline-flex items-center gap-2 overflow-clip rounded-full border border-border-subtle bg-surface-badge py-1.25 pr-3.25 pl-2.75 shadow-float w1024:py-1.75 w1024:pr-3.75 w1024:pl-2.75 ${className}`}
  >
    <PulseDot />
    <span className="text-label leading-label font-medium tracking-badge whitespace-nowrap text-foreground-muted">
      {label}
    </span>
  </span>
);
