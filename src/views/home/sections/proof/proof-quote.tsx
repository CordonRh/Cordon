"use client";

import { useRef, type ReactNode } from "react";

import { InviewSeen } from "@/components/ui/inview-seen";
import type { ProofStat } from "@/data/mocks/home/proof";

import { PROOF_TIMING } from "./timing";

/** Same focus-in as the shared FocusText (blur + left → right mask sweep). */
/** Quicker than SPRING_SOFT: each line resolves in ~0.45 s. */
const QUOTE_SPRING = { tension: 260, friction: 30 } as const;

const MASK =
  "linear-gradient(90deg, black calc(var(--reveal) - 40%), transparent var(--reveal))";

/**
 * FocusText with an external trigger: the name and role sit ~70 px under
 * the quote, below the VIEW_MARGIN line when the section fills a 900 px
 * screen, so the whole figure starts on the figure being seen.
 * (Shared FocusText has no `trigger` prop yet.)
 */
const Focus = ({
  trigger,
  tag,
  delay,
  className,
  children,
}: {
  trigger: React.RefObject<HTMLElement>;
  tag: "p" | "span";
  delay: number;
  className?: string;
  children: ReactNode;
}) => (
  <InviewSeen
    tag={tag}
    mode="once"
    trigger={trigger}
    from={{ opacity: 0, filter: "blur(8px)", "--reveal": "0%" }}
    to={{ opacity: 1, filter: "blur(0px)", "--reveal": "140%" }}
    config={QUOTE_SPRING}
    delayIn={delay}
    style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    className={className}
  >
    {children}
  </InviewSeen>
);

/**
 * Column quote at offset 326 (381 at 1024, where it runs three lines in a
 * 278-wide column and the caption follows 24 under it; 395 at 768, where the
 * caption row sits at a fixed 112 under the quote top whatever its length,
 * 3832:8607; in flow at 390, caption 12 under the quote): the quote focuses in as soon as the row is
 * seen, name and role follow right behind it (whole figure ≈ 0.7 s).
 */
export const ProofQuote = ({
  quote,
  delay,
}: {
  quote: ProofStat["quote"];
  delay: number;
}) => {
  const ref = useRef<HTMLElement>(null);
  const trigger = ref as React.RefObject<HTMLElement>;

  return (
    <figure
      ref={ref}
      className="absolute top-81.5 left-0 flex w-96 flex-col w1024:top-95.25 w1024:w-69.5 w768:top-98.75 w768:w-54.5 w390:static w390:mt-6 w390:w-full"
    >
      <blockquote className="text-body leading-body text-foreground">
        <Focus trigger={trigger} tag="p" delay={delay}>
          {quote.text}
        </Focus>
      </blockquote>
      <figcaption className="mt-10 flex flex-col gap-0.5 text-label leading-label w1024:mt-6 w1024:gap-1 w768:absolute w768:top-28 w768:left-0 w768:mt-0 w768:w-full w390:static w390:mt-3">
        <Focus
          trigger={trigger}
          tag="span"
          delay={delay + PROOF_TIMING.quoteName}
          className="font-medium whitespace-nowrap text-foreground w768:whitespace-normal"
        >
          {quote.name}
        </Focus>
        <Focus
          trigger={trigger}
          tag="span"
          delay={delay + PROOF_TIMING.quoteRole}
          className="font-mono whitespace-nowrap text-foreground-dim w768:whitespace-normal"
        >
          {quote.role}
        </Focus>
      </figcaption>
    </figure>
  );
};
