import { Badge } from "@/components/ui/badge";
import { DisplayTitle, type TitleParts } from "@/components/ui/display-title";
import { FocusText } from "@/components/ui/focus-text";
import { Reveal } from "@/components/ui/reveal";
import { REVEAL } from "@/lib/motion";

export interface SectionHeadProps {
  badge: string;
  title: TitleParts;
  aside: string;
  className?: string;
  /** Extra classes for the aside copy — e.g. a per-frame width. At 390 the
   *  default is `w390:w-full`; override it with an important class. */
  asideClassName?: string;
  /** Extra classes for the badge + title stack — e.g. a per-frame gap. */
  stackClassName?: string;
}

/**
 * Section head — badge and title in a 760 column, 440 aside copy bottom-aligned
 * 48 to the right (04 Product 3488:21991; 06 3488:22269, 07 3488:22343,
 * 09 3488:22782 share the layout).
 *
 * The narrower frames stack it centred instead: badge, then the title 24 below
 * (12 at 390), then the aside 16 below that — 560 wide, full width at 390.
 */
export const SectionHead = ({
  badge,
  title,
  aside,
  className = "",
  asideClassName = "",
  stackClassName = "",
}: SectionHeadProps) => (
  <header
    className={`flex items-end gap-12 w1024:flex-col w1024:items-center w1024:gap-4 ${className}`}
  >
    <Reveal
      className={`flex w-190 flex-col items-start gap-4 w1024:w-full w1024:items-center w1024:gap-6 w390:gap-3 ${stackClassName}`}
    >
      <Badge label={badge} />
      <DisplayTitle
        {...title}
        className="text-section-title leading-section-title w1024:text-center"
        delay={REVEAL.step}
        accentClassName="text-section-title-accent"
      />
    </Reveal>
    <FocusText
      delay={2 * REVEAL.step}
      className={`w-110 text-body leading-body text-foreground-muted w1024:w-140 w1024:text-center w390:w-full ${asideClassName}`}
    >
      {aside}
    </FocusText>
  </header>
);
