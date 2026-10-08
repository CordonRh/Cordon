import Image from "@/components/compat/image";

import { Badge } from "@/components/ui/badge";
import { DisplayTitle } from "@/components/ui/display-title";
import { DrawLine } from "@/components/ui/draw-line";
import { Reveal } from "@/components/ui/reveal";
import type { ProofContent } from "@/data/mocks/home/proof";
import { REVEAL } from "@/lib/motion";

import { BloomDrift } from "./bloom-drift";
import { StatColumn } from "./stat-column";
import { PROOF_TIMING } from "./timing";

/** Column x in the frame: 80 / 528 / 976 at 1440, 48 / 372 / 696 at 1024,
    40 / 274 / 508 at 768. At 390 the columns are stacked cards in flow. */
const COLUMN_LEFT = [
  "left-20 w1024:left-12 w768:left-10",
  "left-132 w1024:left-93 w768:left-68.5",
  "left-244 w1024:left-174 w768:left-127",
] as const;

/**
 * 08 Proof — 1440 × 884 (3888:6908), 1024 × 816 (3888:11313), 768 × 906
 * (3832:8566), 390 × 1706 (3893:4222).
 * Everything sits at its frame coordinates: head at y96 / y40 / y40 / y48,
 * hairlines at y300 / y626 (1440), y246 / y643 (1024), y246 / y657 (768),
 * stat columns from y332 / y295 / y295. From 1024 down the head stacks
 * centred above the columns instead of splitting title left / aside right,
 * and the columns narrow 384 → 278 → 218. At 390 the three columns become
 * stacked 350-wide cards from y281, 12 apart, and the section hairlines go.
 * The shared field texture sits behind this section (backdrop), not here.
 */
export const Proof = ({
  badge,
  title,
  aside,
  stats,
  dimHours,
}: ProofContent) => (
  <section
    id="proof"
    aria-label={`${title.before}${title.accent}${title.after}`}
    className="[content-visibility:auto] relative h-221 w1024:h-204 w768:h-226.5 w390:h-426.5"
  >
    {/*
      Blooms 3488:22725 / 3488:22726 — the Figma SVG (σ80 blur, 0.035 fill) baked
      to dithered PNGs: Chrome's 8-bit SVG blur rounds every level up (+0.5–1 on
      the whole glow, visible banding), Figma's export dithers. Unoptimized so
      the dither survives; the wrapper clips at the section edges like the frame.
      Each bloom drifts ±40 px with scroll, in opposite directions.
    */}
    <Reveal
      tag="div"
      variant="fade"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-clip"
    >
      <BloomDrift direction={-1}>
        <Image
          src="/assets/proof/proof-bloom-right.png"
          unoptimized
          alt=""
          width={940}
          height={680}
          className="absolute top-5 left-150 h-170 w-235 max-w-none w1024:-top-38 w1024:-left-40 w1024:w-336 w768:-top-40 w768:w-272 w390:-top-38 w390:w-177.5"
        />
      </BloomDrift>
      <BloomDrift direction={1}>
        <Image
          src="/assets/proof/proof-bloom-left.png"
          unoptimized
          alt=""
          width={940}
          height={680}
          className="absolute top-15 -left-10 h-170 w-235 max-w-none w1024:-top-38 w1024:-left-40 w1024:w-336 w768:-top-40 w768:w-272 w390:-top-38 w390:w-177.5"
        />
      </BloomDrift>
    </Reveal>

    <Reveal
      tag="div"
      className="absolute top-24 left-20 flex w-134 flex-col items-start gap-1.5 w1024:top-10 w1024:left-12 w1024:w-232 w1024:items-center w1024:gap-6 w768:left-10 w768:w-172 w390:top-12 w390:left-5 w390:w-87.5 w390:gap-3"
    >
      <Badge label={badge} />
      <DisplayTitle
        {...title}
        delay={REVEAL.step}
        className="text-section-title leading-section-title w1024:w-232 w1024:text-center w768:w-172 w390:w-67.75"
        accentClassName="text-section-title-accent"
      />
    </Reveal>

    <Reveal
      tag="p"
      variant="fade"
      delay={2 * REVEAL.step}
      className="absolute top-35 left-230 w-110 text-body leading-body text-foreground-muted w1024:top-41.5 w1024:left-66.5 w1024:w-123 w1024:text-center w768:left-44.25 w768:w-103.75 w390:top-44.25 w390:left-7.75 w390:w-82"
    >
      {aside}
    </Reveal>

    <DrawLine
      delay={PROOF_TIMING.hairlineTop}
      className="absolute top-75 left-20 h-px w-320 rounded-full bg-proof-hairline w1024:top-61.5 w1024:left-12 w1024:w-232 w768:left-10 w768:w-172 w390:hidden"
    />
    <DrawLine
      delay={PROOF_TIMING.hairlineBottom}
      className="absolute top-156.5 left-20 h-px w-320 rounded-full bg-proof-hairline w1024:top-160.75 w1024:left-12 w1024:w-232 w768:top-164.25 w768:left-10 w768:w-172 w390:hidden"
    />

    <ul className="w390:absolute w390:top-70.25 w390:left-5 w390:flex w390:w-87.5 w390:flex-col w390:gap-3">
      {stats.map((stat, i) => (
        <li
          key={stat.id}
          className={`absolute top-83 h-114 w-96 w1024:top-73.75 w1024:h-130.25 w1024:w-69.5 w768:h-142.75 w768:w-54.5 ${COLUMN_LEFT[i]} w390:relative w390:top-auto w390:left-auto w390:h-auto w390:w-full w390:overflow-clip w390:rounded-proof-card w390:border w390:border-proof-card-border w390:bg-proof-card w390:p-5`}
        >
          <StatColumn
            stat={stat}
            dimHours={dimHours}
            index={i}
            delay={PROOF_TIMING.column(i)}
          />
        </li>
      ))}
    </ul>
  </section>
);
