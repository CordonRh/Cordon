"use client";

import { animated, useSprings } from "@react-spring/web";
import { useEffect, useState } from "react";

import type { PricingContent } from "@/data/mocks/home/pricing";
import { REVEAL, SPRING_SOFT } from "@/lib/motion";

import { INITIAL, RunMeter, planIndex } from "./run-meter";
import { TierCard } from "./tier-card";

type PlanBoardProps = {
  meter: PricingContent["meter"];
  tiers: PricingContent["tiers"];
};

/**
 * Card column in design px: at 1440, 413 wide with a 20 gap and the last card
 * taking the 414 left over; at 1024 (3888:11404) three equal 301.33 columns
 * with a 12 gap. 768 (3876:31) and 390 (3893:4316) stack the cards full width
 * with a 12 gap — 311 tall each at 768; 417 / 423 / 417 at 390. The highlight
 * layers are laid out by the same flex box as the cards, so they can never
 * drift from them in any frame.
 */
const STACKED = "w768:h-77.75 w768:w-full w768:flex-none";
const TIER_SIZE = [
  `h-full w-103.25 w1024:basis-0 w1024:grow ${STACKED} w390:h-104.25`,
  `h-full w-103.25 w1024:basis-0 w1024:grow ${STACKED} w390:h-105.75`,
  `h-full flex-1 ${STACKED} w390:h-104.25`,
] as const;

/** Card row box, shared by the cards and the two highlight layers. */
const BOX =
  "absolute top-120 left-20 h-99.5 w-320 w1024:top-151.5 w1024:left-12 w1024:h-108.5 w1024:w-232 w768:top-168.25 w768:left-10 w768:h-239.25 w768:w-172 w390:top-200.5 w390:left-5 w390:h-320.25 w390:w-87.5";
const GAP = "flex gap-5 w1024:gap-3 w768:flex-col";
const ROW = `${BOX} ${GAP}`;
/** A highlight layer stacked on the same columns, inside the box above. */
const LAYER = `absolute inset-0 ${GAP}`;

/** Pointer devices that can really hover — card rings stay off on touch. */
const useCanHover = () => {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setCan(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return can;
};

/**
 * Run meter + plan cards. One card at a time carries the Team look — lime
 * stroke, glow and lime button: the card under the pointer, otherwise the
 * slider's plan (Team at rest). The look cross-fades softly between cards
 * (each card owns its layers; nothing slides across the row), so leaving a
 * card hands it back to the default one.
 */
export const PlanBoard = ({ meter, tiers }: PlanBoardProps) => {
  const [pos, setPos] = useState<number>(INITIAL);
  const [hover, setHover] = useState<number | null>(null);
  const canHover = useCanHover();
  const selected = planIndex(pos, tiers);
  const lit = canHover && hover !== null ? hover : selected;

  /* one soft, overdamped spring per card: the selected plan's stroke and glow
     cross-fade in place — nothing slides over the row */
  const [marks] = useSprings(
    tiers.length,
    (n) => ({ o: n === lit ? 1 : 0, config: SPRING_SOFT }),
    [lit],
  );

  return (
    <>
      {/* the cards are simply there — only their contents animate in (client call) */}
      <div
        className="absolute top-39.5 left-20 h-75.5 w-320 overflow-clip rounded-pricing-card border border-pricing-card-border bg-pricing-card backdrop-blur-card w1024:top-71.5 w1024:left-12 w1024:h-77 w1024:w-232 w768:top-59.5 w768:left-10 w768:h-105.75 w768:w-172 w390:top-62 w390:left-5 w390:h-135.5 w390:w-87.5"
      >
        <RunMeter meter={meter} tiers={tiers} pos={pos} onPos={setPos} />
      </div>

      <div aria-hidden="true" className={`pointer-events-none ${ROW}`}>
        {marks.map(({ o }, n) => (
          <animated.span
            key={tiers[n].name}
            className={`shrink-0 rounded-pricing-card shadow-pricing-featured ${TIER_SIZE[n]}`}
            style={{ opacity: o }}
          />
        ))}
      </div>

      <ul className={ROW}>
        {tiers.map((tier, n) => (
          <li key={tier.name} className={`shrink-0 ${TIER_SIZE[n]}`}>
            <div
              className="size-full"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover((h) => (h === n ? null : h))}
            >
              <TierCard
                tier={tier}
                delay={(n + 2) * REVEAL.step}
                lit={n === lit}
              />
            </div>
          </li>
        ))}
      </ul>

      <div aria-hidden="true" className={`pointer-events-none ${BOX}`}>
        <div className={LAYER}>
          {marks.map(({ o }, n) => (
            <animated.span
              key={tiers[n].name}
              className={`stroke-ring shrink-0 rounded-pricing-card [background:var(--pricing-featured-stroke)] ${TIER_SIZE[n]}`}
              style={{ opacity: o }}
            />
          ))}
        </div>
      </div>
    </>
  );
};
