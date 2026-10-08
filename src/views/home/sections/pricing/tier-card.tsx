"use client";

import { animated, useSpring } from "@react-spring/web";
import { useRef, type RefObject } from "react";

import { FocusText } from "@/components/ui/focus-text";
import { InviewSeen } from "@/components/ui/inview-seen";
import { useSeen } from "@/hooks/use-seen";

import type { PricingContent } from "@/data/mocks/home/pricing";
import { SPRING, SPRING_SOFT, STEP } from "@/lib/motion";

/** Feature lines follow each other quickly (user: the card should play faster). */
const FAST = 40;

import { Check } from "./check";
import { GlassTierButton } from "./glass-tier-button";
import { TEAM_CTA_BOX, TeamCta } from "./team-cta";
import { TypeLabel } from "./type-label";

type Tier = PricingContent["tiers"][number];

const FEATURE_SIZE = {
  label: "text-label leading-label w768:text-body w768:leading-body",
  body: "text-body leading-body",
} as const;

/** "most picked" pops in with a small overshoot (motion brief, pricing cards). */
const POP = { tension: 320, friction: 17 } as const;

/**
 * 1024 and 390 nudge the featured card's whole text block 6px down against its
 * taller tag (Tier / Team 3888:11424, 3950:735 vs Starter 3888:11405,
 * 3950:716) — 390 also its hairline and button; 768 moves only the text block,
 * 8px (3876:51 vs 3876:32). 1440 keeps all three cards on the same lines.
 */
const HEAD = {
  plain: {
    name: "w1024:top-5.75",
    price: "w1024:top-14.25 w768:top-16.75 w390:top-14.25",
    list: "w1024:top-39.25 w768:top-33.25 w390:top-37.75",
    rule: "w390:top-76.75",
    button: "w390:top-83",
    shade: "w390:top-86.5",
  },
  featured: {
    name: "w1024:top-7.25 w768:top-7.75 w390:top-7.25",
    price: "w1024:top-15.75 w768:top-18.75 w390:top-15.75",
    list: "w1024:top-39.25 w768:top-35.25 w390:top-39.25",
    rule: "w390:top-78.25",
    button: "w390:top-84.5",
    shade: "w390:top-88",
  },
} as const;

/**
 * Feature rows are a fixed 32 at 1440 and 768; 1024 gives the 16/24 lines 36,
 * and 390 sets every line 16/24 on a 36 pitch.
 */
const ROW_HEIGHT = {
  label: "h-8 w1024:h-9 w768:h-8 w390:h-9",
  body: "h-8 w1024:h-9 w768:h-8 w390:h-9",
} as const;

/** FocusText's mask sweep, driven by the card's own trigger (see below). */
const MASK =
  "linear-gradient(90deg, black calc(var(--reveal) - 40%), transparent var(--reveal))";

/**
 * Plan card, 413 × 398 (Tier / Starter 3888:6997, Team 3888:7015, Scale
 * 3888:7035) and 301.33 × 434 at 1024 (3888:11405/24/45), where the price
 * drops to 36/50, the feature column to 229 (so the last line of Team and
 * Scale wraps), the buttons grow to 60 and the hairline above them comes back.
 * 768 (3876:32/51/72) is 688 × 311: price 36/50 with the period beside it,
 * the features 16/24 in two 332 columns, a 48 button. 390 (3950:716/35/56) is
 * 350 wide: every feature line 16/24 on a 36 pitch, a 60 button.
 * Children sit at the frame's coordinates, measured inside the
 * 1px border. The lime stroke + glow of the selected plan is painted by the
 * board over the row, so every card here keeps the plain hairline border; the
 * featured card keeps its tag, light checks and lime button. Glass buttons
 * draw their drop shadow as a blurred layer behind the 7% fill, as Figma
 * shows it through (showShadowBehindNode).
 *
 * Text entrance: the plan name types, the price focuses in, then the period
 * types; each feature line focuses in a STEP after its check pops. The list
 * and checks run off the card being seen, not each line: the lower lines sit
 * below the view line when the card rests at the bottom of the screen, and
 * would otherwise stay blank there.
 */
/** Glass button box inside a card (1440 / 1024 / 768 / 390). */
const BUTTON_BOX =
  "absolute top-79.25 right-7.75 left-7.75 w1024:top-87.25 w1024:right-5.75 w1024:left-5.75 w768:top-59.5 w768:h-12 w390:right-4.75 w390:left-4.75 w390:h-15";

export const TierCard = ({
  tier,
  delay,
  lit,
}: {
  tier: Tier;
  delay: number;
  /** Carries the Team look (lime button) — Team by default, else the hovered card. */
  lit: boolean;
}) => {
  const look = useSpring({ l: lit ? 1 : 0, config: SPRING_SOFT });
  const card = useRef<HTMLElement>(null);
  const seen = useSeen(card);
  const head = HEAD[tier.featured ? "featured" : "plain"];

  return (
    <article
      ref={card}
      className="relative size-full overflow-clip rounded-pricing-card border border-pricing-card-border bg-pricing-card backdrop-blur-card"
    >
      <TypeLabel
        tag="h3"
        delay={delay}
        className={`absolute! top-7.75 left-7.75 font-mono text-label leading-label whitespace-nowrap text-foreground-muted w1024:left-5.75 w390:left-4.75 ${head.name}`}
      >
        {tier.name}
      </TypeLabel>
      {/* Price over period; 768 sets the period beside the price, 12 after
          it, on the price's last line minus 6 (3876:34/35). */}
      <div
        className={`absolute top-14.25 left-7.75 flex flex-col items-start gap-2.5 whitespace-nowrap w1024:left-5.75 w1024:gap-1 w768:flex-row w768:items-end w768:gap-3 w390:left-4.75 w390:flex-col w390:items-start w390:gap-1 ${head.price}`}
      >
        <FocusText
          delay={delay + STEP}
          className="text-pricing-price leading-pricing-price font-semibold tracking-title text-foreground"
        >
          {tier.price}
        </FocusText>
        <p className="font-mono text-label leading-label text-foreground-dim w768:mb-1.75 w390:mb-0">
          <TypeLabel
            delay={delay + 2 * STEP}
            trigger={card as RefObject<HTMLElement>}
          >
            {tier.period}
          </TypeLabel>
        </p>
      </div>

      {"tag" in tier && (
        <InviewSeen
          tag="p"
          mode="once"
          from={{ opacity: 0, scale: 0.6 }}
          to={{ opacity: 1, scale: 1 }}
          config={POP}
          delayIn={delay + 4 * STEP}
          className="absolute top-7.75 left-65 rounded-pricing-tag bg-accent px-3 py-1.5 font-mono text-label leading-label whitespace-nowrap text-on-accent w1024:top-5.75 w1024:left-38.25 w1024:py-2 w768:left-135.75 w390:left-52.25"
        >
          {tier.tag}
        </InviewSeen>
      )}

      <ul
        className={`absolute top-40.25 left-7.75 flex flex-col w1024:left-5.75 w768:grid w768:grid-cols-2 w768:gap-x-6 w390:gap-x-0 w390:left-4.75 w390:flex ${head.list}`}
      >
        {tier.features.map((feature, n) => (
          <li
            key={feature.label}
            className={`flex items-start gap-2.5 w1024:gap-3.5 ${ROW_HEIGHT[feature.size]}`}
          >
            <Check
              light={tier.featured}
              seen={seen}
              delay={delay + (1 + n) * FAST}
            />
            <InviewSeen
              tag="span"
              mode="once"
              trigger={card as RefObject<HTMLElement>}
              from={{ opacity: 0, filter: "blur(8px)", "--reveal": "0%" }}
              to={{ opacity: 1, filter: "blur(0px)", "--reveal": "140%" }}
              config={SPRING}
              delayIn={delay + (2 + n) * FAST}
              style={{ maskImage: MASK, WebkitMaskImage: MASK }}
              className={`w-70 text-foreground-muted w1024:w-57.25 w768:w-71 w390:w-71.5 ${FEATURE_SIZE[feature.size]}`}
            >
              {feature.label}
            </InviewSeen>
          </li>
        ))}
      </ul>

      {/* No hairline above the buttons at 1440; 1024, 768 and 390 draw one
          (3888:11421, 3876:48, 3950:732). */}
      <span
        aria-hidden="true"
        className={`absolute top-81.25 left-5.75 hidden h-px w-63.25 bg-pricing-hairline w1024:block w768:top-53.5 w768:w-160 w390:left-4.75 w390:w-77.5 ${head.rule}`}
      />

      {/* Both looks are always there and cross-fade: the lit card (Team by
          default, or the one under the pointer) shows the lime button, the
          others the glass one — only the visible one takes clicks. */}
      <animated.div
        aria-hidden={lit}
        inert={lit}
        className="absolute inset-0"
        style={{
          opacity: look.l.to((l) => 1 - l),
          pointerEvents: lit ? "none" : "auto",
        }}
      >
        <span
          aria-hidden="true"
          className={`absolute top-82.75 right-8.75 left-8.75 h-10 rounded-full bg-pricing-button-shade blur-pricing-button-shade w1024:top-90.75 w1024:right-6.75 w1024:left-6.75 w1024:h-13 w768:top-63 w768:h-10 w390:right-5.75 w390:left-5.75 w390:h-13 ${head.shade}`}
        />
        <GlassTierButton
          href={tier.cta.href}
          className={`${BUTTON_BOX} ${head.button}`}
        >
          {tier.cta.label}
        </GlassTierButton>
      </animated.div>
      <animated.div
        aria-hidden={!lit}
        inert={!lit}
        className="absolute inset-0"
        style={{ opacity: look.l, pointerEvents: lit ? "auto" : "none" }}
      >
        <TeamCta
          href={tier.cta.href}
          label={tier.cta.label}
          className={
            tier.featured
              ? TEAM_CTA_BOX
              : `${BUTTON_BOX} h-12 w1024:h-15 w768:h-12 w390:h-15 ${head.button}`
          }
        />
      </animated.div>
    </article>
  );
};
