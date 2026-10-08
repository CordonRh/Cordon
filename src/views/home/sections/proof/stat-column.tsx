import { DrawLine } from "@/components/ui/draw-line";
import { FocusText } from "@/components/ui/focus-text";
import { Reveal } from "@/components/ui/reveal";
import { TypeText } from "@/components/ui/type-text";
import type { ProofStat } from "@/data/mocks/home/proof";

import { CountUp } from "./count-up";
import { ProofQuote } from "./proof-quote";
import { StatVisual } from "./stat-visual";
import { PROOF_TIMING } from "./timing";

/** Trend text tone per column: lime everywhere at 1440, muted after the first from 1024 down. */
const TREND_TONE = [
  "",
  "w1024:text-foreground-muted",
  "w1024:text-foreground-muted",
] as const;

/** The 768 designer wraps the middle pill at 140 (3832:8579). */
const TREND_TEXT = ["", "w768:w-35 w390:w-auto", ""] as const;

interface StatColumnProps {
  stat: ProofStat;
  dimHours: number;
  /** Column index (0–2): staggers the visual and the quote row. */
  index: number;
  /** Where this column starts in the section cascade, ms. */
  delay: number;
}

/**
 * One stat column (e.g. 3488:22730–22771), offsets relative to the column top
 * at frame y332: number 32, caption 104, visual 148, trend pill 226, column
 * tick 293 (sits on the y626 hairline), quote 326.
 *
 * 1024 (3603:4143–4185) starts the column at y287 and is a touch tighter:
 * number 28, caption 92 (two lines), visual 156, trend pill 236 (a full-width
 * 278 × 64 box that wraps), tick 347, quote 381.
 *
 * 768 (3832:8572–8622): same column top y295, 218 wide: number 28, caption
 * 84, visual 148, trend pill 228 (218 × 64), tick 361, quote 395.
 *
 * 390 (3943:695–697): the columns become stacked cards and every row flows —
 * label, number +8, caption +12, visual +24, pill +24, the card's own hairline
 * +24, quote +24. Only the first card keeps its tick (on that hairline).
 *
 * Motion: label types → number counts up → caption focuses → visual plays →
 * trend pill rises → tick draws with the quote focusing in → name, role.
 * The mini visual loops while on screen; the number counts once.
 */
export const StatColumn = ({
  stat,
  dimHours,
  index,
  delay,
}: StatColumnProps) => {
  const pillAt =
    delay + PROOF_TIMING.visual + PROOF_TIMING.visualLength[stat.visual];
  const quoteAt = PROOF_TIMING.quoteStagger(index);
  // At 390 the progress card's visual is only the 14-tall track.
  const visualHeight = stat.visual === "progress" ? "w390:h-3.5" : "";

  return (
    <>
      <p className="absolute top-0 left-0 font-mono w390:static text-label leading-label whitespace-nowrap text-foreground-muted">
        <TypeText delay={delay}>{stat.label}</TypeText>
      </p>
      <CountUp
        value={stat.value}
        delay={delay + PROOF_TIMING.number}
        className="absolute top-8 left-0 text-proof-stat leading-proof-stat font-semibold tracking-title whitespace-nowrap text-foreground w1024:top-7 w390:static w390:mt-2 w390:block"
      />
      <FocusText
        tag="p"
        delay={delay + PROOF_TIMING.caption}
        className="absolute top-26 left-0 w-96 font-mono text-label leading-label text-foreground-muted w1024:top-23 w1024:w-69.5 w768:top-21 w768:w-54.5 w390:static w390:mt-3 w390:w-full"
      >
        {stat.caption}
      </FocusText>

      <div
        aria-hidden="true"
        className={`absolute top-37 left-0 h-14 w-96 w1024:top-39 w1024:w-69.5 w768:top-37 w768:w-54.5 w390:relative w390:top-auto w390:mt-6 w390:w-full ${visualHeight}`}
      >
        <StatVisual
          kind={stat.visual}
          dimHours={dimHours}
          delay={PROOF_TIMING.visualStagger(index)}
        />
      </div>

      {/* Trend pill — Figma stroke is inside, so padding is 12/6 minus the 1px
          border (16/12 at 1024, where the pill is a fixed 278 × 64 box whose
          text wraps and centres; its outline turns subtle there, see proof.css).
          From 1024 down only the first pill keeps the lime text; 218 wide at
          768 (the middle one wraps at 140), full card width at 390. */}
      <Reveal
        tag="p"
        delay={pillAt}
        className={`absolute top-56.5 left-0 overflow-clip rounded-proof-trend border border-proof-trend-border bg-surface-glass px-2.75 py-1.25 font-mono text-label leading-label whitespace-nowrap text-accent w1024:top-59 w1024:flex w1024:h-16 w1024:w-69.5 w1024:items-center w1024:px-3.75 w1024:py-2.75 w1024:whitespace-normal ${TREND_TONE[index]} w768:top-57 w768:w-54.5 w390:static w390:mt-6 w390:w-full`}
      >
        <span className={TREND_TEXT[index]}>{stat.trend}</span>
      </Reveal>

      {/* 390: each card carries its own hairline (3893:4258). */}
      <div className="hidden w390:mt-6 w390:block">
        <DrawLine
          delay={quoteAt}
          className="h-px w-full rounded-full bg-proof-hairline"
        />
      </div>

      <DrawLine
        delay={quoteAt}
        className={`absolute top-73.25 left-0 h-0.5 w-7 rounded-full bg-proof-tick w1024:top-86.75 w768:top-90.25 w390:top-76.5 w390:left-5 ${index > 0 ? "w390:hidden" : ""}`}
      />

      <ProofQuote quote={stat.quote} delay={quoteAt} />
    </>
  );
};
