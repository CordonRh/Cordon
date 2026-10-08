import type { FooterContent } from "@/data/mocks/home/footer";

import { CueLineRise } from "./stage";

/**
 * CTA title 3488:22898 — "Line by line": the single line rises out of a mask
 * (the h2 clips), serif "hate" travelling with it. Ink on lime.
 * 1024 (3888:11497) and 390 (3954:723) drop to 32/42, 768 (3876:125) to
 * 26/34 — the serif word stops stepping up (sizes switch in footer.css). At
 * 390 the title wraps to two lines, so the rise is a share of its own height.
 */
export const CtaTitle = ({
  title,
  delay = 0,
}: {
  title: FooterContent["cta"]["title"];
  delay?: number;
}) => (
  <h2 className="absolute top-19 left-10 w-162.5 overflow-clip text-footer-cta-title leading-footer-cta-title font-semibold tracking-wordmark text-on-accent w1024:top-15 w1024:left-6 w1024:w-102.25 w768:top-17 w768:w-156 w390:top-15 w390:left-5 w390:w-63.5">
    <CueLineRise stage="top" delay={delay}>
      {title.before}
      <span className="font-serif text-footer-cta-accent leading-footer-cta-title font-normal italic">
        {title.accent}
      </span>
      {title.after}
    </CueLineRise>
  </h2>
);
