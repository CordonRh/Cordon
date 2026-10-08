import { InviewSeen } from "@/components/ui/inview-seen";
import { SPRING } from "@/lib/motion";

export interface WindowNodeProps {
  title: string;
  source: string;
  /** Position + width utilities. */
  className?: string;
  /** Amount over 5000 carries the lime glow; the rest the float shadow. */
  glow?: boolean;
  /** ms into the load sequence the card comes up at. */
  delay?: number;
}

/**
 * Canvas node — 76 tall card, title over a mono source line
 * (3542:25216, 3542:25220, 3542:25223, 3542:25233). Padding is Figma's 20/14
 * less the 1px border it draws inside. Comes up 8px + fade in flow order.
 * Frosted glass (not in Figma), so the particle stream shows through.
 *
 * 1024 (3699:7, 3699:854, 3699:858, 3699:861): 188 × 64, padding 16/12, both
 * lines centred and the title down to the 14/20 label size. 768 (3834:1755 …)
 * is 172 × 60: the same content centred, 10 above and below.
 */
export const WindowNode = ({
  title,
  source,
  className = "",
  glow = false,
  delay = 0,
}: WindowNodeProps) => (
  <InviewSeen
    mode="once"
    from={{ opacity: 0, y: 8 }}
    to={{ opacity: 1, y: 0 }}
    config={SPRING}
    delayIn={delay}
    className={`absolute flex flex-col items-start gap-1 overflow-clip rounded-hero-node border border-hero-node-border bg-hero-node backdrop-blur-hero-card px-4.75 py-3.25 whitespace-nowrap w1024:items-center w1024:gap-0 w1024:px-3.75 w1024:py-2.75 w768:py-2.25 ${glow ? "shadow-hero-node-glow" : "shadow-float"} ${className}`}
  >
    <p className="text-body leading-body font-medium text-foreground w1024:text-label w1024:leading-label">
      {title}
    </p>
    <p className="font-mono text-label leading-label text-foreground-dim">
      {source}
    </p>
  </InviewSeen>
);
