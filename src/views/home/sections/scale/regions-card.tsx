"use client";

import { animated, useSpring } from "@react-spring/web";
import Image from "@/components/compat/image";

import { FocusText } from "@/components/ui/focus-text";
import { TypeText } from "@/components/ui/type-text";
import type { ScaleContent } from "@/data/mocks/home/scale";
import { REVEAL, STEP } from "@/lib/motion";

import { ScaleCard } from "./card";
import { LaneBar } from "./lane-bar";
import { ScaleType } from "./scale-type";
import { useRegionsCycle } from "./use-regions-cycle";

type RegionsCardProps = ScaleContent["regions"] & { index: number };

/** Share widths 121 / 100 / 42 (61 / 50 / 21 at 390); only the first is lime. */
const BARS = [
  {
    width: "[--lane-fill:7.5625rem] w390:[--lane-fill:3.8125rem]",
    fill: "bg-accent",
  },
  {
    width: "[--lane-fill:6.25rem] w390:[--lane-fill:3.125rem]",
    fill: "bg-scale-share",
  },
  {
    width: "[--lane-fill:2.625rem] w390:[--lane-fill:1.3125rem]",
    fill: "bg-scale-share",
  },
] as const;

const MONO = "font-mono text-scale-mono leading-scale-mono";

/** Footer line types in once the bars are under way. */
const FOOTER_DELAY = 700;
/** Lock snaps shut once the lanes have landed, every cycle. */
const LOCK_DELAY = 1_040;

/**
 * Card / Runs where your data lives — 3888:6489 (art 3888:6492), 3949:13160,
 * 3832:8151, 3893:3786. Rows start at y76 on a 72 pitch, hairline 56 below
 * each row start (1440, 768); y44 / 69 pitch at 1024; y28 / 61 pitch, hairline
 * 46 at 390.
 * The art loops (useRegionsCycle): bars grow + count, heads pulse, lock snaps,
 * hold on the Figma frame, ease back, replay. Texts enter once.
 */
export const RegionsCard = ({
  title,
  copy,
  label,
  rows,
  footnote,
  index,
}: RegionsCardProps) => {
  const { ref, phase, reduced } = useRegionsCycle<HTMLUListElement>();
  /* The lock stays centred on the footnote line; it "snaps shut" with a small
     springy pulse (a touch smaller while the lanes are still running). */
  const { lock } = useSpring({
    from: { lock: 0.82 },
    to: { lock: phase === "play" ? 1 : 0.82 },
    delay: phase === "play" && !reduced ? LOCK_DELAY : 0,
    immediate: phase === "off" || reduced,
    config: { tension: 420, friction: 14 },
  });

  return (
    <ScaleCard
      title={title}
      copy={copy}
      index={index}
      artClassName="w390:h-60.75"
    >
      <p
        className={`absolute top-6 left-0 w-129.5 text-foreground-dim w1024:top-0 w1024:left-0 w1024:w-97.5 w768:top-6 w768:w-160 w390:top-0 w390:w-77.5 ${MONO}`}
      >
        {/* Trailing space: TypeText's round(down, n × 1ch, 1ch) lands one ch short at
          34 chars (float error) and clips the last glyph; the space absorbs it. */}
        <TypeText delay={(index + 2) * REVEAL.step}>{`${label} `}</TypeText>
      </p>

      <ul
        ref={ref}
        className="absolute top-19 left-0 w-141.5 w1024:top-11 w1024:left-0 w1024:w-97.5 w768:top-19 w768:w-160 w390:top-7 w390:w-77.5"
      >
        {rows.map((row, i) => (
          <li
            key={row.region}
            className="relative h-18 w1024:h-17.25 w768:h-18 w390:h-15.25"
          >
            <span className="absolute top-0 left-0 font-mono text-scale-region leading-scale-region whitespace-nowrap text-foreground">
              <TypeText delay={(index + 3 + i) * REVEAL.step}>
                {`${row.region} `}
              </TypeText>
            </span>
            <FocusText
              tag="span"
              delay={(index + 3 + i) * REVEAL.step + STEP}
              className="absolute top-6 left-0 text-scale-mono leading-scale-mono whitespace-nowrap text-foreground-dim w390:top-5"
            >
              {row.city}
            </FocusText>
            <LaneBar
              fillWidthClassName={BARS[i].width}
              fillClassName={BARS[i].fill}
              share={row.share}
              delay={0.8 * (index + 3 + i) * REVEAL.step}
              phase={phase}
              reduced={reduced}
            />
            <span
              aria-hidden="true"
              className="absolute top-14 left-0 h-px w-full bg-scale-hairline w390:top-11.5"
            />
          </li>
        ))}
      </ul>

      {/* lock centred on the footnote's first line (3972:702) in every frame */}
      <animated.span
        aria-hidden="true"
        style={{ scale: lock }}
        className="absolute top-73.75 left-0 block size-3.5 w1024:top-64.75 w1024:left-0 w768:top-72.75 w390:top-53.25 w390:size-3"
      >
        <Image
          src="/assets/scale/scale-lock.svg"
          alt=""
          width={14}
          height={14}
          className="block size-3.5 w390:size-3"
        />
      </animated.span>
      <p
        className={`absolute top-73 left-6.5 w-123 text-foreground-dim w1024:top-64 w1024:left-5.5 w1024:w-97.5 w768:top-72 w768:w-149 w390:top-52.75 w390:left-5 w390:w-43.5 ${MONO}`}
      >
        <ScaleType trigger={ref} delay={FOOTER_DELAY}>
          {footnote}
        </ScaleType>
      </p>
    </ScaleCard>
  );
};
