"use client";

import { animated, useSpring, useSprings } from "@react-spring/web";
import Image from "@/components/compat/image";

import type { ProductContent } from "@/data/mocks/home/product";
import { pick, useFrame } from "@/hooks/use-frame";
import { SPRING, SPRING_SOFT } from "@/lib/motion";

import { CARD } from "./feature-row";
import { CARD_START } from "./use-card-play";
import { useLoopCycle } from "./use-loop-cycle";

/* Figma's contact shadows under the cubes (3888:5916 → 5921) are left out on
   the designer's request — they read as smudges on the card. */

/**
 * Cube groups (3888:5925, 5932, 5939, 5946, 5953, 5960): 76 wide, bottom on
 * y254, 123 apart. `box` places the body (faces, 76 × h); the 60 × 32 cap
 * sits 8 in at the group top.
 *
 * At 1024 (3888:10324 → 10354, card 528 × 320) they are 57 wide on an 85
 * pitch from x24, caps 45 × 24 at +6 — evenly spaced, nothing overlaps.
 * At 768 (3849:80 → 110) they are 0.789 wide × 0.778 tall, 84 apart from x24;
 * at 390 (3893:3219 → 3259) 0.566 × 0.557, 53 apart from x20.
 */
const CUBES = [
  {
    box: "top-36.25 left-8.25 h-27 w1024:top-40.25 w1024:left-5.75 w1024:h-23 w768:top-40.75 w768:left-5.75 w768:h-21 w390:top-35.75 w390:left-4.75 w390:h-15",
    cap: "top-36.25 left-10.25 w1024:top-40.25 w1024:left-7.25 w768:top-40.75 w768:left-7.25 w390:top-35.75 w390:left-[calc(var(--spacing)*5.875)]",
    h: 108,
  },
  {
    box: "top-31.25 left-39 h-32 w1024:top-36 w1024:left-27 w1024:h-27.25 w768:top-37 w768:left-26.75 w768:h-24.75 w390:top-32.75 w390:left-18 w390:h-17.75",
    cap: "top-31.25 left-41 w1024:top-36 w1024:left-28.5 w768:top-37 w768:left-28.25 w390:top-32.75 w390:left-[calc(var(--spacing)*19.125)]",
    h: 128,
  },
  {
    box: "top-25.75 left-69.75 h-37.5 w1024:top-31.25 w1024:left-48.25 w1024:h-32 w768:top-32.75 w768:left-47.75 w768:h-29 w390:top-29.75 w390:left-31.25 w390:h-21",
    cap: "top-25.75 left-71.75 w1024:top-31.25 w1024:left-49.75 w768:top-32.75 w768:left-49.25 w390:top-29.75 w390:left-[calc(var(--spacing)*32.375)]",
    h: 150,
  },
  {
    box: "top-19.75 left-100.5 h-43.5 w1024:top-26 w1024:left-69.25 w1024:h-37.25 w768:top-28 w768:left-68.75 w768:h-33.75 w390:top-26.5 w390:left-44.5 w390:h-24.25",
    cap: "top-19.75 left-102.5 w1024:top-26 w1024:left-70.75 w768:top-28 w768:left-70.25 w390:top-26.5 w390:left-[calc(var(--spacing)*45.625)]",
    h: 174,
  },
  {
    box: "top-13.75 left-131.25 h-49.5 w1024:top-21 w1024:left-90.25 w1024:h-42.25 w768:top-23.5 w768:left-89.75 w768:h-38.25 w390:top-23 w390:left-57.75 w390:h-27.5",
    cap: "top-13.75 left-133.25 w1024:top-21 w1024:left-91.75 w768:top-23.5 w768:left-91.25 w390:top-23 w390:left-[calc(var(--spacing)*58.875)]",
    h: 198,
  },
  {
    box: "top-7.75 left-162.25 h-55.5 w1024:top-16 w1024:left-111.5 w1024:h-47.5 w768:top-18.75 w768:left-110.75 w768:h-43 w390:top-19.75 w390:left-71 w390:h-31",
    cap: "top-7.75 left-164.25 w1024:top-16 w1024:left-113 w768:top-18.75 w768:left-112.25 w390:top-19.75 w390:left-[calc(var(--spacing)*72.125)]",
    h: 222,
  },
] as const;

/** Day label centres (3888:5930 → 5965; 1024 3888:10360 → 10365; 768 3849:116 → 121; 390 3893:3225 → 3265). */
const DAYS = [
  "left-17.75 w1024:left-12.75 w768:left-13.25 w390:left-[calc(var(--spacing)*10.125)]",
  "left-48.5 w1024:left-34 w768:left-34.25 w390:left-[calc(var(--spacing)*23.375)]",
  "left-79.25 w1024:left-55.25 w768:left-55.25 w390:left-[calc(var(--spacing)*36.625)]",
  "left-110 w1024:left-76.25 w768:left-76.25 w390:left-[calc(var(--spacing)*49.875)]",
  "left-140.75 w1024:left-97.25 w768:left-97.25 w390:left-[calc(var(--spacing)*63.125)]",
  "left-171.75 w1024:left-118.5 w768:left-118.25 w390:left-[calc(var(--spacing)*76.375)]",
] as const;

const MONO =
  "font-mono text-product-small leading-product-small w390:leading-4";

/** Cubes: 120 ms apart, a looser spring for a slight (~5%) overshoot. */
const CUBE_STEP = 120;
const CUBE_SPRING = { tension: 390, friction: 20.8 } as const;
const CAP_AFTER = 208;
/** How far a cap falls, px — scaled with the cubes' height in each frame. */
const CAP_DROP = { 1440: -26, 1024: -23, 768: -20, 390: -14.5 } as const;
const GLOW_AFTER = 304;
const cubeAt = (i: number) => CARD_START + i * CUBE_STEP;
/** Last cap landed + glow swell. */
const PLAY_MS = cubeAt(CUBES.length - 1) + CAP_AFTER + GLOW_AFTER + 720;

/**
 * Row 03 bar chart — "Bars grow" (motion brief, product.chart): cubes grow
 * from the baseline one by one with a slight overshoot, diamond caps drop onto
 * them, Saturday's lime cap glows. Loops while on screen; at rest every layer
 * is identity — the Figma group exports.
 */
export const ChartCard = ({ chart }: Pick<ProductContent, "chart">) => {
  const { ref, on, reduced, snap } = useLoopCycle(PLAY_MS);
  const capDrop = pick(useFrame(), CAP_DROP);
  const count = CUBES.length;

  const [cubes] = useSprings(
    count,
    (i) => ({
      from: { s: 0 },
      to: { s: on ? 1 : 0 },
      delay: on ? cubeAt(i) : (count - 1 - i) * 32,
      config: on ? CUBE_SPRING : SPRING,
      immediate: snap,
    }),
    [on, snap],
  );
  const [caps] = useSprings(
    count,
    (i) => ({
      from: { opacity: 0, y: capDrop },
      to: on ? { opacity: 1, y: 0 } : { opacity: 0, y: capDrop },
      delay: on ? cubeAt(i) + CAP_AFTER : (count - 1 - i) * 32,
      config: SPRING,
      immediate: snap,
    }),
    [on, snap, capDrop],
  );
  // Saturday's cap flashes a glow once it has landed, then back to the Figma rest.
  const [glow] = useSpring(
    () => ({
      from: { g: 0 },
      to: on && !reduced ? [{ g: 1 }, { g: 0 }] : { g: 0 },
      delay: on ? cubeAt(count - 1) + CAP_AFTER + GLOW_AFTER : 0,
      config: SPRING_SOFT,
      immediate: snap,
    }),
    [on, snap],
  );

  return (
    <figure
      ref={ref}
      className={`${CARD} h-82 w1024:h-80 w768:h-80.25 w390:h-65.75`}
    >
      {CUBES.map((cube, i) => (
        <span key={cube.box}>
          <animated.span
            className={`absolute w-19 w1024:w-14.25 w768:w-15 w390:w-10.75 ${cube.box}`}
            style={{
              transformOrigin: "50% 100%",
              transform: cubes[i].s.to((s) => `scaleY(${Math.max(0, s)})`),
            }}
          >
            <Image
              src={`/assets/product/product-cube-${i + 1}.svg`}
              alt=""
              width={76}
              height={cube.h}
              className="block size-full max-w-none"
            />
          </animated.span>
          {i === count - 1 && (
            <animated.span
              aria-hidden="true"
              className={`absolute -mt-5 -ml-5 h-18 w-25 w1024:-mt-3.75 w1024:-ml-3.75 w1024:h-13.5 w1024:w-18.75 w768:-mt-4 w768:-ml-4 w768:h-14 w768:w-19.75 w390:-mt-2.75 w390:-ml-2.75 w390:h-10 w390:w-14.25 ${cube.cap}`}
              style={{
                opacity: glow.g,
                scale: glow.g.to((g) => 0.8 + 0.45 * g),
              }}
            >
              <Image
                src="/assets/product/product-cap-glow.svg"
                alt=""
                width={100}
                height={72}
                className="block h-18 w-25 max-w-none w1024:h-13.5 w1024:w-18.75 w768:h-14 w768:w-19.75 w390:h-10 w390:w-14.25"
              />
            </animated.span>
          )}
          <animated.span
            className={`absolute h-8 w-15 w1024:h-6 w1024:w-11.25 w768:h-6.25 w768:w-11.75 w390:h-4.5 w390:w-8.5 ${cube.cap}`}
            style={caps[i]}
          >
            <Image
              src={`/assets/product/product-cap-${i + 1}.svg`}
              alt=""
              width={60}
              height={32}
              className="block h-8 w-15 max-w-none w1024:h-6 w1024:w-11.25 w768:h-6.25 w768:w-11.75 w390:h-4.5 w390:w-8.5"
            />
          </animated.span>
        </span>
      ))}
      <span className="absolute top-64.75 left-7.75 h-px w-174 bg-product-chart-baseline w1024:top-65.5 w1024:left-5.75 w1024:w-120 w768:top-65.75 w768:left-5.75 w768:w-120 w390:top-53.25 w390:left-4.75 w390:w-77.5" />

      <ul>
        {chart.days.map((day, i) => (
          <li
            key={day}
            className={`absolute top-68.75 w-20 -translate-x-1/2 text-center w1024:top-68.75 w768:top-69 w390:top-56.5 w390:w-10.75 ${MONO} ${DAYS[i]} ${i === DAYS.length - 1 ? "text-accent" : "text-foreground-dim"}`}
          >
            {day}
          </li>
        ))}
      </ul>

      <figcaption>
        <span
          className={`absolute top-7.75 left-7.75 whitespace-nowrap text-foreground-dim w1024:top-5.75 w1024:left-5.75 w768:top-5.75 w768:left-5.75 w390:top-4.75 w390:left-4.75 ${MONO}`}
        >
          {chart.caption}
        </span>
        <span
          className={`absolute top-7.75 left-53.25 whitespace-nowrap text-foreground-muted w1024:top-5.75 w1024:left-95.25 w768:top-5.75 w768:left-95.25 w390:top-9.75 w390:left-4.75 ${MONO}`}
        >
          {chart.average}
        </span>
      </figcaption>
    </figure>
  );
};
