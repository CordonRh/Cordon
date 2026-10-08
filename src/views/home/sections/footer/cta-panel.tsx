import type { FooterContent } from "@/data/mocks/home/footer";

import { CtaTitle } from "./cta-title";
import { SignupForm } from "./signup-form";
import { CUE, CueFocus, CueRise, CueType } from "./stage";

/**
 * CTA panel 3488:22896 — 730 × 308 at (630, 96), lime fill; narrow
 * 3888:11495 — 457 × 278 at (519, 0); 768 3876:123 — 688 × 278 at (40, 330);
 * 390 3954:721 — 350 × 340 at (20, 321). It leads the footer timeline: panel,
 * then title (eyebrow typing with it), copy, form.
 */
export const CtaPanel = ({
  eyebrow,
  title,
  copy,
  emailLabel,
  submit,
}: FooterContent["cta"]) => (
  <CueRise
    stage="top"
    delay={CUE.panels}
    className="absolute top-24 left-157.5 h-80 w-182.5 overflow-clip rounded-footer-panel bg-accent shadow-float w1024:top-0 w1024:left-129.75 w1024:h-69.5 w1024:w-114.25 w768:top-82.5 w768:left-10 w768:w-172 w390:top-80.25 w390:left-5 w390:h-85 w390:w-87.5"
  >
    <p className="absolute top-10 left-10 font-mono text-label leading-label whitespace-nowrap text-footer-ink-eyebrow w1024:top-6 w1024:left-6 w390:left-5">
      <CueType stage="top" delay={CUE.title}>
        {eyebrow}
      </CueType>
    </p>
    <CtaTitle title={title} delay={CUE.title} />
    <CueFocus
      stage="top"
      delay={CUE.copy}
      className="absolute top-34 left-10 w-162.5 text-body leading-body text-footer-ink-copy w1024:top-30.5 w1024:left-6 w1024:w-102.25 w768:top-31.5 w768:w-108 w390:top-40 w390:left-5 w390:w-77.5"
    >
      {copy}
    </CueFocus>
    <CueRise
      stage="top"
      delay={CUE.form}
      className="absolute top-57 left-10 w1024:top-49.5 w1024:left-6 w390:top-65 w390:left-5"
    >
      <SignupForm emailLabel={emailLabel} submit={submit} />
    </CueRise>
  </CueRise>
);
