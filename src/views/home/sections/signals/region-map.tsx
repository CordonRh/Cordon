"use client";

import { animated, useSprings } from "@react-spring/web";
import Image from "@/components/compat/image";
import { useCallback, useRef } from "react";

import { TypeText } from "@/components/ui/type-text";
import type { SignalsContent } from "@/data/mocks/home/signals";
import { SPRING, SPRING_SOFT } from "@/lib/motion";

import { MAP_DOTS } from "./map-dots";
import {
  useAfter,
  useFrameLoop,
  useReducedMotionPref,
  useSeen,
} from "./use-signals-motion";
import { TYPED_CLIP } from "./widget";

/** SPRING_SOFT ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SOFT_FAST = {
  tension: SPRING_SOFT.tension * 1.5,
  friction: SPRING_SOFT.friction * 1.22,
} as const;
/** SPRING ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SPRING_FAST = {
  tension: SPRING.tension * 1.5,
  friction: SPRING.friction * 1.22,
} as const;

/**
 * Marker geometry per region, in widget coordinates straight from the frames
 * (inside the 1px border): the dot (region ring 28, blurred halo, pin 9) at
 * the ring's corner, the label plate and its label.
 * 1440 3888:6892…6907 · 1024 3888:11297…11312 (dot parts only move, map
 * scaled to 253 × 91, plate 77 wide) · 768 3840:2588…2607 (dot drawn at 24,
 * plate 73 × 22, map 290 × 104) · 390 3893:4089…4108 (dot 26, plate 78 × 23
 * with 15/21 labels, map 310 × 111).
 */
const MARKER = {
  iad: {
    dot: "top-21.25 left-16.25 w1024:top-23.75 w1024:left-12.25 w768:top-30.75 w768:left-8.75 w390:top-26.25 w390:left-8",
    plate: "top-22.25 left-22.25 w1024:top-24.25 w1024:left-19.25 w768:top-31 w768:left-14.75 w390:top-26.5 w390:left-14.5",
    label: "top-22.75 left-24.25 w1024:top-24.75 w1024:left-21.25 w768:top-31.25 w768:left-16.25 w390:top-26.75 w390:left-16",
  },
  fra: {
    dot: "top-19.5 left-41.25 w1024:top-19.25 w1024:left-31.25 w768:top-24.5 w768:left-34.25 w390:top-19.5 w390:left-35.25",
    plate: "top-20.25 left-48 w1024:top-19.75 w1024:left-38.25 w768:top-24.75 w768:left-40.25 w390:top-19.75 w390:left-41.75",
    label: "top-20.75 left-50 w1024:top-20.25 w1024:left-40.25 w768:top-25 w768:left-41.75 w390:top-20 w390:left-43.25",
  },
  syd: {
    dot: "top-32.25 left-77 w1024:top-32 w1024:left-27.5 w768:top-42.75 w768:left-28.75 w390:top-39 w390:left-29.25",
    plate: "top-34.75 left-59.25 w1024:top-32.5 w1024:left-34.5 w768:top-43 w768:left-34.75 w390:top-39.25 w390:left-35.75",
    label: "top-35.25 left-61.25 w1024:top-33 w1024:left-36.5 w768:top-43.25 w768:left-36.25 w390:top-39.5 w390:left-37.25",
  },
} as const;

/** Halo (exported 34 with its blur bleed) and pin inside the 28 dot box. */
const HALO = "-top-0.75 -left-0.75 w1024:-top-0.5 w1024:-left-0.5";
const PIN = "top-2.5 left-2.5 w1024:top-2.25 w1024:left-2.25";

/** Dots fade in by pseudo-random bucket so the map fills in scattered. */
const BUCKETS = 9;
const bucketOf = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0) % BUCKETS;
const DOT_STEP = 44;
/** Pins drop after the dots, one region at a time. */
const PIN_START = 416;
const PIN_STEP = 112;
const DROP = 14;
/** Ping: every PERIOD ms per pin, offset per region, visible for PING ms. */
const PERIOD = 2400;
const PING = 1040;
const PING_OFFSET = 360;

type Props = Pick<SignalsContent["regions"], "mapLabel" | "markers"> & {
  delay?: number;
};

/**
 * Where-it-ran map: dots appear scattered, pins drop in, then a ring pings
 * out of each pin every ~2.4 s while the widget is in view. Off screen it
 * rewinds to the empty map, so the next visit starts from the dots again.
 */
export const RegionMap = ({ mapLabel, markers, delay = 0 }: Props) => {
  const [ref, seen, inView] = useSeen();
  const reduced = useReducedMotionPref();
  const landed = useAfter(
    seen,
    delay + PIN_START + markers.length * PIN_STEP + 400,
  );

  const dots = useSprings(
    BUCKETS,
    Array.from({ length: BUCKETS }, (_, b) => ({
      o: seen ? 1 : 0,
      delay: delay + b * DOT_STEP,
      immediate: !seen,
      config: SOFT_FAST,
    })),
  );
  const pins = useSprings(
    markers.length,
    markers.map((_, k) => ({
      y: seen ? 0 : -DROP,
      o: seen ? 1 : 0,
      delay: delay + PIN_START + k * PIN_STEP,
      immediate: !seen,
      config: SPRING_FAST,
    })),
  );

  const rings = useRef<(HTMLSpanElement | null)[]>([]);
  const onFrame = useCallback((elapsed: number) => {
    rings.current.forEach((el, k) => {
      if (!el) return;
      const t = (elapsed - k * PING_OFFSET) % PERIOD;
      const p = t < 0 || t > PING ? 1 : t / PING;
      const e = 1 - (1 - p) ** 3;
      el.style.opacity = p >= 1 ? "0" : String(0.8 * (1 - e));
      el.style.transform = `scale(${0.28 + 0.72 * e})`;
    });
  }, []);
  const hideRings = useCallback(() => {
    rings.current.forEach((el) => {
      if (el) el.style.opacity = "0";
    });
  }, []);
  useFrameLoop(landed && inView && !reduced, onFrame, !seen, hideRings);

  return (
    <>
      <svg
        ref={ref}
        role="img"
        aria-label={mapLabel}
        width={366}
        height={132}
        viewBox="0 0 366 132"
        className="absolute top-13.25 left-5.75 h-33 w-91.5 fill-signals-map-dot w1024:top-17.75 w1024:h-auto w1024:w-63.25 w768:top-23.5 w768:w-72.5 w390:top-18.5 w390:left-4.75 w390:w-77.5"
      >
        {dots.map(({ o }, b) => (
          <animated.g key={b} style={{ opacity: o }}>
            {MAP_DOTS.map(([cx, cy], i) =>
              bucketOf(i) === b ? (
                <ellipse key={i} cx={cx} cy={cy} rx={1.525} ry={1.4} />
              ) : null,
            )}
          </animated.g>
        ))}
      </svg>
      {/* Frame order: every label plate + label first, the ring / halo / pin
          stacks above them (a plate never covers a pin). */}
      <ul aria-hidden="true">
        {markers.map(({ id, label }, k) => {
          const m = MARKER[id];
          return (
            <li key={id}>
              <animated.span
                style={{ opacity: pins[k].o }}
                className={`absolute h-6 w-18.75 rounded-signals-plate bg-signals-plate shadow-float w1024:w-19.25 w768:h-5.5 w768:w-18.25 w390:h-5.75 w390:w-19.5 ${m.plate}`}
              />
              <span
                className={`absolute font-mono text-label leading-label whitespace-nowrap text-foreground w390:text-signals-pin-390 w390:leading-signals-pin-390 ${m.label}`}
              >
                <TypeText
                  className={TYPED_CLIP}
                  delay={delay + PIN_START + k * PIN_STEP + 160}
                >
                  {label}
                </TypeText>
              </span>
            </li>
          );
        })}
      </ul>
      <ul aria-hidden="true">
        {markers.map(({ id }, k) => {
          const m = MARKER[id];
          const { y, o } = pins[k];
          return (
            <li
              key={id}
              className={`absolute size-7 origin-top-left w768:scale-[calc(24/28)] w390:scale-[calc(26/28)] ${m.dot}`}
            >
              <animated.span
                style={{ opacity: o }}
                className="absolute top-0 left-0 size-7"
              >
                <Image
                  src="/assets/signals/signals-region-ring.svg"
                  alt=""
                  width={28}
                  height={28}
                  className="block size-7"
                />
              </animated.span>
              <animated.span
                style={{ opacity: o }}
                className={`absolute size-8.5 ${HALO}`}
              >
                <Image
                  src="/assets/signals/signals-halo.svg"
                  alt=""
                  width={34}
                  height={34}
                  className="block size-8.5 max-w-none"
                />
              </animated.span>
              <span className={`absolute size-2.25 ${PIN}`}>
                <span
                  ref={(el) => {
                    rings.current[k] = el;
                  }}
                  style={{ opacity: 0 }}
                  className="absolute top-1/2 left-1/2 -mt-4 -ml-4 size-8 rounded-full border border-accent"
                />
              </span>
              <animated.span
                style={{
                  opacity: o,
                  transform: y.to((v) =>
                    v === 0 ? "none" : `translateY(${v}px)`,
                  ),
                }}
                className={`absolute size-2.25 ${PIN}`}
              >
                <Image
                  src="/assets/signals/signals-pin.svg"
                  alt=""
                  width={9}
                  height={9}
                  className="block size-2.25"
                />
              </animated.span>
            </li>
          );
        })}
      </ul>
    </>
  );
};
