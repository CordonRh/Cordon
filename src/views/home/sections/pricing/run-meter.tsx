"use client";

import { animated, useSpring } from "@react-spring/web";
import Image from "@/components/compat/image";
import { useEffect, useId, type CSSProperties } from "react";

import { FocusText } from "@/components/ui/focus-text";
import { PillButton } from "@/components/ui/pill-button";

import type { PricingContent } from "@/data/mocks/home/pricing";
import { pick, useFrame, type Frame } from "@/hooks/use-frame";
import { SPRING, STEP } from "@/lib/motion";

import { PriceRoll } from "./price-roll";
import { SwapText } from "./swap-text";
import { TypeLabel } from "./type-label";

type RunMeterProps = {
  meter: PricingContent["meter"];
  tiers: PricingContent["tiers"];
  /**
   * Slider position in decades above the first tier's runs (0 = 3,000,
   * 1 = 30,000, 2 = 300,000) — owned by the board so the cards can follow.
   * Decades, not track px, so the two track geometries below share one value.
   */
  pos: number;
  onPos: (pos: number) => void;
};

/**
 * Track geometry in design px, one per frame (`useFrame`, the same lines as the
 * `w*:` variants, so CSS and motion can never disagree). `length` is the knob
 * centre's travel; `stops` are the knob centres for 3,000 / 30,000 / 300,000.
 * 1440 (Track 3888:6979) runs 60px past 300,000; 1024 (3888:11387) ends on
 * it. Both, as drawn, centre the knob on each tick from the text line. 768 (3876:14) and 390 (3950:698) end their track at the card padding,
 * so the knob travels inside Figma's track: 26 shorter, the middle stop at
 * Figma's knob centre (fill 275 / 133 at 30,000, as drawn).
 */
type Track = { length: number; stops: readonly [number, number, number] };
const TRACKS: Record<Frame, Track> = {
  1440: { length: 860, stops: [0, 373, 760] },
  1024: { length: 616, stops: [0, 265, 616] },
  768: { length: 614, stops: [0, 262, 614] },
  390: { length: 284, stops: [0, 120, 284] },
};

/** Figma rests the knob on the middle stop — 30,000 runs, Team. */
export const INITIAL = 1;

/** Decades → track px, interpolated inside each decade and past the last stop. */
const toPx = (pos: number, track: Track) => {
  const i = pos <= 1 ? 0 : 1;
  return track.stops[i] + (pos - i) * (track.stops[i + 1] - track.stops[i]);
};

/** Track px → decades (the inverse of `toPx`). */
const toPos = (px: number, track: Track) => {
  const i = px <= track.stops[1] ? 0 : 1;
  return i + (px - track.stops[i]) / (track.stops[i + 1] - track.stops[i]);
};

/*
 * The knob (r 13) sits inside the text column: at 3,000 its left edge — not its
 * centre — is on the column line (x39 / x23 / x23 / x19), so knob centres and
 * ticks sit 13px right of Figma's 3,000 tick; labels keep Figma's offset from
 * their tick except 3,000, which stays on the column line with the texts above.
 * 768 and 390 end the 300,000 tick 13px inside Figma's too, and right-align its
 * label to the column end as drawn.
 */
const TICK_X = [
  "left-9.75 w1024:left-5.75 w390:left-8",
  "left-103 w1024:left-72 w768:left-74.5 w390:left-38",
  "left-199.75 w1024:left-159.75 w768:left-165.75 w390:left-79",
] as const;
const LABEL_X = [
  "left-9.75 w1024:left-5.75 w390:left-4.75",
  "left-98 w1024:left-65.5 w768:left-68 w390:left-31.5",
  "left-194.75 w1024:left-144.5 w768:left-150.5 w390:left-67",
] as const;

const format = (runs: number) => runs.toLocaleString("en-US");

/** The result column types in after the question column. */
const REVEAL_TYPE = 240;

/** Runs at a slider position — a tenfold step per decade, rounded to 100. */
const toRuns = (pos: number, tiers: RunMeterProps["tiers"]) => {
  const i = pos <= 1 ? 0 : 1;
  return Math.round((tiers[i].runs * 10 ** (pos - i)) / 100) * 100;
};

/** Index of the plan that covers the runs at a slider position. */
export const planIndex = (pos: number, tiers: RunMeterProps["tiers"]) => {
  const runs = toRuns(pos, tiers);
  const i = tiers.findIndex((tier) => runs <= tier.runs);
  return i === -1 ? tiers.length - 1 : i;
};

/**
 * Run meter card content (3888:6976, 1024: 3888:11384). A native range input
 * sits invisibly over the drawn track so keyboard, touch and screen readers
 * work, while the resting render — knob at 30,000, Team shown — matches the
 * frame exactly. The drawn knob and fill trail the input on a spring; the plan
 * price rolls. The input is stepped in track px of the current width, so the
 * drag feel is unchanged at 1024; the position it reports is width-independent.
 *
 * At 1024 the result column narrows to 200 and its "a month" drops under the
 * price instead of sitting beside it (3888:11400/01). 768 (3876:11) drops the
 * vertical rule and puts the result under the slider: plan name left, price
 * and period right-aligned, then rule, runs and a full-width CTA. 390
 * (3950:695) stacks it all in one column under a horizontal rule.
 */
export const RunMeter = ({ meter, tiers, pos, onPos }: RunMeterProps) => {
  const id = useId();
  const track = pick(useFrame(), TRACKS);
  /* 1440 runs 60px past the last tick; the other frames end on it, so a
     position taken from the wide track is pulled back in on a narrower one. */
  const max = toPos(track.length, track);
  const level = Math.min(pos, max);
  useEffect(() => {
    if (pos > max) onPos(max);
  }, [pos, max, onPos]);

  const runs = toRuns(level, tiers);
  const plan = tiers[planIndex(level, tiers)];
  const px = Math.round(toPx(level, track));
  const { knob } = useSpring({ knob: px / track.length, config: SPRING });
  const fill = {
    "--pricing-fill": knob.to((v) => String(v)),
  } as unknown as CSSProperties;

  return (
    <>
      <p className="absolute top-9.75 left-9.75 font-mono text-label leading-label whitespace-nowrap text-foreground-dim w1024:top-17 w1024:left-5.75 w768:top-5.75 w390:left-4.75">
        <TypeLabel>{meter.eyebrow}</TypeLabel>
      </p>
      <label
        htmlFor={id}
        className="absolute top-16.75 left-9.75 text-pricing-question leading-pricing-question font-medium tracking-wordmark whitespace-nowrap text-foreground w1024:top-24 w1024:left-5.75 w768:top-12.75 w390:left-4.75 w390:w-66 w390:whitespace-normal"
      >
        <FocusText tag="span" delay={STEP} className="block">
          {meter.question}
        </FocusText>
      </label>

      <animated.div style={fill}>
        <input
          id={id}
          type="range"
          min={0}
          max={track.length}
          step={1}
          value={px}
          onChange={(event) => onPos(toPos(Number(event.target.value), track))}
          aria-valuetext={`${format(runs)} USDG value, ${Math.round(runs * 0.001)} USDG bundle fee`}
          className="peer absolute top-35.5 left-9.75 m-0 h-6.5 w-215 cursor-pointer appearance-none opacity-0 w1024:top-42.75 w1024:left-5.75 w1024:w-154 w768:top-24.5 w768:left-9 w768:w-153.5 w390:top-33 w390:left-8 w390:w-71 [&::-moz-range-thumb]:size-px [&::-webkit-slider-thumb]:size-px [&::-webkit-slider-thumb]:appearance-none"
        />
        <div className="pointer-events-none absolute top-37.25 left-9.75 h-3 w-215 overflow-clip rounded-full bg-pricing-track outline-offset-4 outline-accent peer-focus-visible:outline-2 w1024:top-44.5 w1024:left-5.75 w1024:w-154 w768:top-26.25 w768:w-160 w390:top-34.75 w390:left-4.75 w390:w-77.5">
          <div className="h-full w-[calc(var(--pricing-fill)*--spacing(215))] bg-linear-to-r/srgb from-pricing-fill-from to-pricing-fill-to w1024:w-[calc(var(--pricing-fill)*--spacing(154))] w768:w-[calc(--spacing(3.25)+var(--pricing-fill)*--spacing(153.5))] w390:w-[calc(--spacing(3.25)+var(--pricing-fill)*--spacing(71))]" />
        </div>
        <div className="pointer-events-none absolute top-31 left-9.75 h-19 w-215 w1024:top-38.25 w1024:left-5.75 w1024:w-154 w768:top-20 w768:left-9 w768:w-153.5 w390:top-28.5 w390:left-8 w390:w-71">
          <Image
            src="/assets/pricing/pricing-knob.svg"
            alt=""
            width={70}
            height={76}
            className="absolute top-0 left-[calc(var(--pricing-fill)*100%_-_--spacing(8.75))] h-19 w-17.5 max-w-none"
          />
        </div>
      </animated.div>

      {tiers.map((tier, i) => {
        const active = tier.name === plan.name;
        return (
          <div key={tier.name} aria-hidden="true">
            <span
              className={`absolute top-43.25 h-2.5 w-px w1024:top-50.5 w768:top-32.25 w390:top-40.75 ${TICK_X[i]} ${active ? "bg-pricing-tick-active" : "bg-pricing-tick"}`}
            />
            <TypeLabel
              delay={2 * STEP + i * STEP}
              className={`absolute! top-47.25 font-mono text-label leading-label whitespace-nowrap w1024:top-54.5 w768:top-36.25 w390:top-44.75 ${LABEL_X[i]} ${active ? "text-foreground" : "text-foreground-dim"}`}
            >
              {format(tier.runs)}
            </TypeLabel>
          </div>
        );
      })}

      <span className="absolute top-10 left-241.75 h-55.5 w-px bg-pricing-hairline w1024:top-5.75 w1024:left-167.75 w1024:h-65 w768:hidden w390:top-55.75 w390:left-4.75 w390:block w390:h-px w390:w-77.5" />

      <div aria-live="polite">
        <p className="absolute top-9.75 left-251.75 font-mono text-label leading-label whitespace-nowrap text-foreground-dim w1024:top-5.75 w1024:left-175.75 w768:top-49.25 w768:left-5.75 w390:top-62 w390:left-4.75">
          <TypeLabel delay={REVEAL_TYPE}>{meter.resultEyebrow}</TypeLabel>
        </p>
        <FocusText
          delay={REVEAL_TYPE + STEP}
          className="absolute top-15.75 left-251.75 text-pricing-question leading-pricing-question font-medium tracking-wordmark whitespace-nowrap text-foreground w1024:top-12.75 w1024:left-175.75 w768:top-55.25 w768:left-5.75 w390:top-69 w390:left-4.75"
        >
          <SwapText>{"Bundle fee"}</SwapText>
        </FocusText>
        <p className="absolute top-26.75 left-251.75 flex items-end gap-4.25 whitespace-nowrap w1024:top-22.75 w1024:left-175.75 w1024:flex-col w1024:items-start w1024:gap-0.5 w768:top-49.25 w768:right-5.75 w768:left-auto w768:items-end w768:gap-1 w390:top-79 w390:right-auto w390:left-4.75 w390:items-start w390:gap-0.5">
          <PriceRoll
            price={`$${Math.round(runs * 0.001)}`}
            prices={["$9999", `$${Math.round(runs * 0.001)}`]}
            className="text-pricing-price leading-pricing-price font-semibold tracking-title text-foreground"
          />
          <TypeLabel
            delay={REVEAL_TYPE}
            className="font-mono text-label leading-label text-foreground-muted"
          >
            {meter.period}
          </TypeLabel>
        </p>
        <span className="absolute top-41.75 left-251.75 h-px w-58 bg-border-subtle w1024:top-43.75 w1024:left-175.75 w1024:w-50 w768:top-71.25 w768:left-5.75 w768:w-160 w390:top-100 w390:left-4.75 w390:w-77.5" />
        {/* Its length changes with the plan, so it focuses in rather than
            types (TypeText clips to the first length it typed). */}
        <FocusText
          delay={REVEAL_TYPE + 3 * STEP}
          className="absolute top-45.25 left-251.75 font-mono text-label leading-label whitespace-nowrap text-foreground-muted w1024:top-49.75 w1024:left-175.75 w768:top-77.5 w768:left-5.75 w390:top-106.25 w390:left-4.75"
        >
          <SwapText>{`${format(runs)} ${meter.included}`}</SwapText>
        </FocusText>
      </div>

      <PillButton
        href={meter.cta.href}
        size="lg"
        className="absolute top-53.25 left-251.75 w-58 w1024:top-58.75 w1024:left-175.75 w1024:w-50 w768:top-87.5 w768:left-5.75 w768:w-160 w390:top-117.25 w390:left-4.75 w390:w-77.5"
      >
        {meter.cta.label}
      </PillButton>
    </>
  );
};
