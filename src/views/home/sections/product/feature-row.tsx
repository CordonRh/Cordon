import type { ReactNode } from "react";

import { FocusText } from "@/components/ui/focus-text";
import { Reveal } from "@/components/ui/reveal";
import { REVEAL, STEP } from "@/lib/motion";

import { RollIndex } from "./roll-index";

export interface FeatureCopy {
  index: string;
  title: string;
  body: string;
}

export interface FeatureRowProps extends FeatureCopy {
  /** The 760 × 328 card (528 wide at 1024 / 768, 350 at 390). */
  visual: ReactNode;
  /** Card on the left, copy on the right (Row 02). */
  flip?: boolean;
  /** Row height and padding per frame — each row is a different height. */
  className?: string;
  /** Extra width constraint for the title (Row 02 wraps at 1024 only). */
  titleClassName?: string;
  /** Extra classes for the body copy — e.g. a narrower 1440 measure. */
  copyClassName?: string;
}

/**
 * Card chrome shared by every row visual — 760 wide, r26 (3888:5827);
 * 528 wide, r18.063 at 1024 (3888:10234); 528, r24 at 768 (3849:2);
 * 350, r24 at 390 (3893:3101). Each card sets its own height.
 */
export const CARD =
  "relative w-190 shrink-0 overflow-clip rounded-product-card border border-product-card-border bg-product-card w1024:w-132 w390:w-87.5";

/**
 * Feature row — each row reveals on its own: copy rises (the 01 index rolls,
 * title then body focus in a STEP apart), the card rises one STEP later, then the card plays its own sequence (motion brief, product.layout).
 * 1280 × 424, py 48, copy column and card spread by
 * `justify-between` (Row 01 3488:21999, Row 02 3488:22044, Row 03 3488:22078).
 *
 * At 1024 the same split holds inside 928 with a 360 copy column and py 32
 * (Row 01 3888:10229, Row 02 3888:10274, Row 03 3888:10308).
 *
 * At 768 the row stacks: centred 520 copy, 32 gap, the 528 card centred,
 * py 32 (3832:7496). At 390 it is copy (350) over the card with a 24 gap
 * and no padding; index → title 8, title → body 16 (3893:3096).
 */
export const FeatureRow = ({
  index,
  title,
  body,
  visual,
  flip = false,
  className = "",
  titleClassName = "",
  copyClassName = "",
}: FeatureRowProps) => {
  const copy = (
    <Reveal
      key="copy"
      className="flex w-110 shrink-0 flex-col items-start gap-4 w1024:w-90 w768:w-130 w768:items-center w768:text-center w390:w-full"
    >
      <RollIndex
        value={index}
        className="font-mono text-label leading-label tracking-product-index text-product-index w390:-mb-2"
      />
      <FocusText
        tag="h3"
        delay={STEP}
        className={`text-product-row-title leading-product-row-title font-medium tracking-product-row-title text-foreground ${titleClassName}`}
      >
        {title}
      </FocusText>
      <FocusText
        delay={2 * STEP}
        className={`text-body leading-body text-foreground-muted ${copyClassName}`}
      >
        {body}
      </FocusText>
    </Reveal>
  );
  const card = (
    <Reveal key="card" delay={REVEAL.step} className="shrink-0">
      {visual}
    </Reveal>
  );

  return (
    <article
      className={`flex items-center justify-between py-12 w1024:py-8 w768:h-auto w768:flex-col w768:justify-start w768:gap-8 w390:gap-6 w390:py-0 ${flip ? "flex-row-reverse" : ""} ${className}`}
    >
      {copy}
      {card}
    </article>
  );
};
