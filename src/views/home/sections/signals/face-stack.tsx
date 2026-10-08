"use client";

import { animated, useSpring, useSprings } from "@react-spring/web";
import Image from "@/components/compat/image";

import { SPRING_SOFT, STEP } from "@/lib/motion";

import { FocusText } from "@/components/ui/focus-text";

import { useLoopPhase, useSeen } from "./use-signals-motion";

/** SPRING_SOFT ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SOFT_FAST = {
  tension: SPRING_SOFT.tension * 1.5,
  friction: SPRING_SOFT.friction * 1.22,
} as const;

/** Faces start spread out to the right (px) and slide into the overlap. */
const FROM = 36;
const SPREAD = 14;
const FACE_STEP = 48;
/** Loop: stack + count (~1.6 s) → hold → faces drift back out, count to 0 → again. */
const PLAY = 1600;
const LOOP = { hold: 2800, reset: 960 } as const;
/** On reset the faces leave last-first, quicker than they came. */
const LEAVE_STEP = 32;

/**
 * Waiting-on-people stack: avatars slide in from the right and overlap into
 * the stack one by one, then the count ticks up to its figure; holds, eases
 * back out and stacks again while on screen.
 */
export const FaceStack = ({
  faces,
  count,
  countLabel,
  delay = 0,
}: {
  faces: readonly string[];
  count: string;
  countLabel: string;
  delay?: number;
}) => {
  const [ref, seen, inView] = useSeen();
  const { on, cycle } = useLoopPhase(seen, inView, {
    lead: delay,
    play: PLAY,
    ...LOOP,
  });
  const lead = cycle === 0 ? delay : 0;
  const springs = useSprings(
    faces.length,
    faces.map((_, i) => ({
      x: on ? 0 : FROM + i * SPREAD,
      o: on ? 1 : 0,
      delay: on ? lead + i * FACE_STEP : (faces.length - 1 - i) * LEAVE_STEP,
      immediate: !seen,
      config: SOFT_FAST,
    })),
  );
  const target = Number.parseInt(count, 10);
  const { n } = useSpring({
    n: on ? 1 : 0,
    delay: on ? lead + faces.length * FACE_STEP : 0,
    immediate: !seen,
    config: SOFT_FAST,
  });

  return (
    <>
      <ul ref={ref} className="absolute top-18 left-5.75 flex -space-x-2 w768:top-16.75 w768:-space-x-3 w390:top-18.5 w390:left-4.75 w390:-space-x-4">
        {faces.map((src, i) => (
          <animated.li
            key={src}
            className="size-13 shrink-0 w768:size-11 w390:size-15"
            style={{
              opacity: springs[i].o,
              transform: springs[i].x.to((v) =>
                v === 0 ? "none" : `translateX(${v}px)`,
              ),
            }}
          >
            <Image
              src={src}
              alt=""
              width={60}
              height={60}
              className="size-13 w768:size-11 w390:size-15"
            />
          </animated.li>
        ))}
      </ul>
      <p className="absolute top-35.5 left-5.75 h-10 w-80 w1024:w-69 w768:top-33.75 w390:top-42.25 w390:left-4.75">
        <animated.span
          aria-hidden="true"
          style={{
            fontVariantNumeric: n.to((v) =>
              v >= 1 ? "normal" : "tabular-nums",
            ),
          }}
          className="absolute top-0 left-0 text-signals-stat leading-signals-stat font-medium tracking-signals-stat whitespace-nowrap text-accent"
        >
          {n.to((v) => String(Math.round(v * target)))}
        </animated.span>
        <span className="sr-only">{count}</span>{" "}
        <FocusText
          tag="span"
          delay={delay + faces.length * FACE_STEP + STEP}
          className="absolute top-2 left-7.5 w768:left-7.25 w390:top-3 text-body leading-body whitespace-nowrap text-foreground-muted"
        >
          {countLabel}
        </FocusText>
      </p>
    </>
  );
};
