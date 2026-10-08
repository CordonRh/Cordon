import type { ReactNode } from "react";

import { FocusText } from "@/components/ui/focus-text";
import { Reveal } from "@/components/ui/reveal";
import { REVEAL, STEP } from "@/lib/motion";

export interface ScaleCardProps {
  title: string;
  copy: string;
  /** Position in the row, drives the reveal stagger. */
  index: number;
  children: ReactNode;
  /** Art 3888:6492 clips its children; Art 3888:6457 does not (only the card clips its glow). */
  clipArt?: boolean;
  /** Art box height at 390, where the two cards differ (251 / 243). */
  artClassName: string;
}

/**
 * Card shell shared by 3888:6454 and 3888:6489 — 630 × 504, padding 32,
 * gap 12, then a 566 × 336 art box. 1024 (3949:13127): 458 × 492, padding 24,
 * gap 32, art 410 × 276. 768 (3832:8118): 688 × 480, padding 24, title→copy 16,
 * copy→art 24, art 640 × 316. 390 (3893:3752): 350 wide, height from content,
 * same gaps, art 310 wide. Padding is one less than Figma for the 1px border.
 */
export const ScaleCard = ({
  title,
  copy,
  index,
  children,
  clipArt = true,
  artClassName,
}: ScaleCardProps) => (
  <Reveal
    tag="article"
    delay={(index + 2) * REVEAL.step}
    className="flex h-120 w-157.5 flex-col items-start gap-3 overflow-clip rounded-scale-card border border-border-subtle bg-linear-to-b/srgb from-scale-card-from to-scale-card-to p-7.75 w1024:h-123 w1024:w-114.5 w1024:gap-8 w1024:p-5.75 w768:h-120 w768:w-172 w768:gap-4 w390:h-auto w390:w-87.5"
  >
    <FocusText
      tag="h3"
      delay={(index + 2) * REVEAL.step}
      className="w-131 text-scale-card-title leading-scale-card-title font-medium tracking-scale-card-title text-foreground w1024:w-102.5 w768:w-160 w390:w-77.5"
    >
      {title}
    </FocusText>
    <FocusText
      delay={(index + 2) * REVEAL.step + STEP}
      className="w-125 text-scale-card-copy leading-scale-card-copy text-foreground-muted w1024:w-102.5 w768:w-130 w390:w-77.5"
    >
      {copy}
    </FocusText>
    <div
      className={`relative h-84 w-full shrink-0 w1024:h-69 w768:mt-2 w768:h-79 w390:w-77.5 ${artClassName} ${clipArt ? "overflow-clip" : ""}`}
    >
      {children}
    </div>
  </Reveal>
);
