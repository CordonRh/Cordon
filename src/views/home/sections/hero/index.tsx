import Image from "@/components/compat/image";

import { DisplayTitle } from "@/components/ui/display-title";
import { PillButton } from "@/components/ui/pill-button";
import { Reveal } from "@/components/ui/reveal";
import { TypeText } from "@/components/ui/type-text";
import type { HeroContent } from "@/data/mocks/home/hero";

import { DepthLayer, HeroTilt } from "./hero-tilt";
import { ProductWindow } from "./product-window";
import { LOAD, TILT } from "./timeline";

/** TypeText's own ms per character — the 1024 note hands it over explicitly so
    the second line starts exactly where the first stops. */
const TYPE_PER = 30;

/**
 * 02 Hero — 1440 × 712 (Figma 3488:21055), directly under the nav.
 * Copy column at x80; the product window group (3542:24364) runs from x646
 * to the frame's right edge. Coordinates are section-relative.
 *
 * At 1024 (3603:2145) the section keeps its 712 height but is re-laid-out:
 * the copy column moves to x48 / 393 wide with a 44/52 headline, the bloom
 * shrinks to 645 × 583 at (396, 65), the two 12px field marks are gone and the
 * product window (3699:3) is a 516 × 659 portrait with a vertical flow.
 *
 * 768 (3832:6548, 976 tall): the copy stacks centred at the top and the window
 * (3834:893, 516 × 590, all corners round) sits under it at (126, 354) with
 * the vertical flow and one run row. 390 (3893:2141, 949 tall): the same
 * stack at 350 wide — full-width buttons, the note on two lines — and the
 * 768 flow scaled 310 / 380 inside a 350 × 515 window at (20, 422).
 */
export const Hero = ({
  chip,
  title,
  subhead,
  actions,
  note,
  noteLines,
  noteLines390,
  window: product,
}: HeroContent) => (
  <section
    id="hero"
    aria-label={`${title.before}${title.accent}${title.after}`}
    className="relative h-[calc(var(--hero-frame)+var(--hero-extra))]"
  >
    {/* the frame's own layout, centred in the viewport-tall section */}
    <div className="absolute inset-x-0 top-[calc(var(--hero-extra)/2)] h-(--hero-frame)">
      <HeroTilt>
        {/* Window bloom 3488:21056 — ellipse at x640 y40, SVG padded 200 (1400 × 1020).
        Not clipped: Figma's render carries the bloom up into the nav.
        Follows the cursor by up to 60px. */}
        <DepthLayer
          depth={TILT.bloom}
          className="pointer-events-none absolute inset-0"
        >
          <Image
            src="/assets/hero/hero-window-bloom.webp"
            alt=""
            width={1400}
            height={1020}
            quality={85}
            fetchPriority="high"
            decoding="sync"
            sizes="(max-width: 580px) 546px, (max-width: 900px) 1260px, (max-width: 1200px) 965px, 1400px"
            className="absolute -top-40 left-110 h-255 w-350 max-w-none w1024:-top-23.75 w1024:left-59 w1024:h-225.75 w1024:w-241.25 w768:-top-51.25 w768:-left-61.5 w768:h-312.5 w768:w-315 w390:-top-61.25 w390:-left-19.5 w390:w-136.5"
            priority
          />
        </DepthLayer>

        {/* Release chip 3488:21930 — padding less the 1px border Figma draws inside. */}
        <Reveal
          delay={LOAD.copy.chip}
          className="absolute top-30.5 left-20 w1024:top-40.5 w1024:left-12 w768:top-10 w768:left-[calc(var(--spacing)*57.875)] w390:top-8 w390:left-10.5"
        >
          <p className="flex h-9 items-center gap-3 overflow-clip rounded-hero-chip border border-hero-chip-border bg-hero-chip-fill backdrop-blur-hero-chip py-1.75 pr-3.25 pl-2.75 w1024:pr-3.75">
            <span aria-hidden className="size-1.5 shrink-0 bg-accent" />
            <TypeText
              delay={LOAD.copy.chipType}
              className="font-mono text-label leading-label whitespace-nowrap text-hero-ink"
            >
              {chip}
            </TypeText>
          </p>
        </Reveal>

        <Reveal
          delay={LOAD.copy.title}
          className="absolute top-48.5 left-20 w-145 w1024:top-56.5 w1024:left-12 w1024:w-95 w768:top-25 w768:left-[calc(var(--spacing)*44.125)] w768:w-104 w390:top-23 w390:left-5 w390:w-87.5"
        >
          <DisplayTitle
            tag="h1"
            delay={LOAD.copy.title}
            {...title}
            className="h-42 text-hero-title leading-hero-title w1024:h-26 w768:h-11.5 w768:text-center w390:h-9.5"
            accentClassName="text-hero-title-accent"
          />
        </Reveal>

        <Reveal
          tag="p"
          variant="fade"
          delay={LOAD.copy.subhead}
          className="absolute top-100.5 left-20 w-117.75 text-lead leading-lead text-foreground-muted w1024:top-88.5 w1024:left-12 w1024:w-95 w768:top-39.5 w768:left-36 w768:w-120.25 w768:text-center w390:top-35.5 w390:left-7.75 w390:w-82 w390:text-body w390:leading-body"
        >
          {subhead}
        </Reveal>

        <Reveal
          delay={LOAD.copy.actions}
          className="absolute top-124.5 left-20 flex items-center gap-3 w1024:top-110.5 w1024:left-12 w768:top-59.5 w768:left-47 w390:top-57.5 w390:left-5 w390:w-87.5 w390:flex-col"
        >
          <PillButton
            href={actions.primary.href}
            size="lg"
            className="w390:w-full w390:justify-center"
          >
            {actions.primary.label}
          </PillButton>
          <PillButton
            href={actions.secondary.href}
            variant="glass"
            size="lg"
            className="w390:w-full w390:justify-center"
          >
            <Image
              src="/assets/hero/hero-play-icon.svg"
              alt=""
              width={16}
              height={16}
              className="size-4 shrink-0"
            />
            {actions.secondary.label}
          </PillButton>
        </Reveal>

        <Reveal
          delay={LOAD.copy.note}
          className="absolute top-142.5 left-20 w1024:top-127.5 w1024:left-12 w768:top-75.5 w768:left-[calc(var(--spacing)*45.25)] w390:top-88 w390:left-[calc(var(--spacing)*21.625)]"
        >
          {/* Trailing nowrap space (collapses, no width): 47 × 1ch rounds down a
            whole ch in TypeText's round(down, …) and shaved the final "s". */}
          <div className="flex w1024:hidden w768:flex w390:hidden">
            <TypeText
              tag="p"
              delay={LOAD.copy.noteType}
              className="font-mono text-label leading-label whitespace-nowrap text-foreground-muted"
            >
              {`${note} `}
            </TypeText>
          </div>
          {/* 1024 (3603:2158) breaks the note over two lines. TypeText clips one
            line horizontally, so each line types on its own — the second picks
            up exactly where the first ends, same ms per character. */}
          <div className="hidden w1024:block w768:hidden">
            {noteLines.map((line, i) => (
              <div key={line} className="flex">
                <TypeText
                  tag="p"
                  delay={
                    LOAD.copy.noteType +
                    (i === 0 ? 0 : TYPE_PER * (noteLines[0].length + 1))
                  }
                  per={TYPE_PER}
                  className="font-mono text-label leading-label whitespace-nowrap text-foreground-muted"
                >
                  {i === 0 ? `${line} ` : line}
                </TypeText>
              </div>
            ))}
          </div>
          {/* 390 (3893:2158): 12 / 1.3, two centred lines in a 217 column. */}
          <div className="hidden w-54.25 w390:block">
            {noteLines390.map((line, i) => (
              <div key={line} className="flex justify-center">
                <TypeText
                  tag="p"
                  delay={
                    LOAD.copy.noteType +
                    (i === 0 ? 0 : TYPE_PER * (noteLines390[0].length + 1))
                  }
                  per={TYPE_PER}
                  className="font-mono text-hero-note leading-hero-note whitespace-nowrap text-foreground-muted"
                >
                  {i === 0 ? `${line} ` : line}
                </TypeText>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Tick 3488:21953 / 3603:2159 and field marks 3488:21954 / 3488:21956 —
          the 1024 frame drops both marks. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <span className="absolute top-155 left-295 h-2 w-px bg-hero-tick w1024:top-136.5 w1024:left-243.75 w768:left-181.75 w390:left-92.25" />
          <Image
            src="/assets/hero/hero-field-mark.svg"
            alt=""
            width={12}
            height={12}
            className="absolute top-168 left-220 size-3 w1024:hidden"
          />
          <Image
            src="/assets/hero/hero-field-mark.svg"
            alt=""
            width={12}
            height={12}
            className="absolute top-167 left-322.5 size-3 w1024:hidden"
          />
        </div>

        <ProductWindow {...product} />
      </HeroTilt>
    </div>
  </section>
);
