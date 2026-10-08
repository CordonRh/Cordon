"use client";

import { animated, to, useSpring, useSprings } from "@react-spring/web";
import Image from "@/components/compat/image";
import { useEffect, useState } from "react";

import type { ProductContent } from "@/data/mocks/home/product";
import { SPRING, SPRING_SOFT, STEP } from "@/lib/motion";

import { CARD } from "./feature-row";
import { CARD_START } from "./use-card-play";
import { useLoopCycle } from "./use-loop-cycle";

/**
 * Field rows beside the accent bar, positions inside the padding box.
 * 1440 (3888:5885): rows 28 apart from y148, key and value share a top
 * (the last value is 24 tall, 2 above its key).
 * 1024 (3888:10288 → 10293): rows 30 apart from key y148, values 2 above.
 * 768 (3840:1019): rows 28 apart from y153, the last value 2 above.
 * 390 (3893:3180): rows 26 apart from y151, one 18 line each.
 */
const FIELD_LAYOUT = [
  {
    key: "top-38.75 w1024:top-36.75 w768:top-38 w390:top-37.5",
    value:
      "top-38.75 text-label leading-label w1024:top-36.25 w768:top-38 w390:top-37.5 w390:leading-product-small",
  },
  {
    key: "top-45.75 w1024:top-44.25 w768:top-45 w390:top-44",
    value:
      "top-45.75 text-label leading-label w1024:top-43.75 w768:top-45 w390:top-44 w390:leading-product-small",
  },
  {
    key: "top-53.25 w1024:top-51.75 w768:top-52.5 w390:top-50.5",
    value:
      "top-52.75 text-body leading-body w1024:top-51.25 w768:top-52 w390:top-50.5 w390:text-label w390:leading-product-small",
  },
] as const;

const MONO = "font-mono text-product-small leading-product-small";
const MINI_BUTTON =
  "absolute top-62.75 flex items-center gap-2 overflow-clip rounded-product-button text-product-mini leading-product-mini font-medium whitespace-nowrap shadow-float w768:top-63 w390:top-60 w390:gap-1.5";

/** Timeline, ms after the card enters view. */
const AT = {
  typing: CARD_START,
  typingOut: CARD_START + 880,
  message: CARD_START + 920,
  fields: CARD_START + 1120,
  fieldStep: 1.6 * STEP,
  bar: CARD_START + 1120 + 3.2 * STEP,
  /** Approve, Hold, then the waiting time — one STEP apart. */
  buttons: CARD_START + 1560,
} as const;
/** Typing dots: two hops each, the three dots a quarter-hop apart, over this long. */
const HOPS_MS = 640;
const HOP_LAG = 0.25;
const HOP_PX = 3;
const hopY = (t: number, i: number) => {
  const p = Math.min(2, Math.max(0, t * (2 + 2 * HOP_LAG) - i * HOP_LAG));
  return -HOP_PX * Math.abs(Math.sin(Math.PI * p));
};
/** "waiting 26 min" gains a minute this often once the buttons are up. */
const TICK_MS = 720;
/** Ticks stop here so the hold keeps a steady value. */
const MAX_TICKS = 4;
const TICK_AT = AT.buttons + 1.6 * STEP + 400;
/** Play length: typing → buttons, then a few visible ticks. */
const PLAY_MS = TICK_AT + 3 * TICK_MS;

const RISE_FROM = { opacity: 0, y: 8 };
const RISE_TO = { opacity: 1, y: 0 };

/**
 * Row 02 Slack card — "Message arrives" (motion brief, product.approval):
 * typing dots → Relay's message → fields line by line → accent bar grows down →
 * Approve / Hold rise → the waiting time ticks while in view.
 */
export const ApprovalCard = ({
  approval,
}: Pick<ProductContent, "approval">) => {
  const { ref, on, reduced, snap } = useLoopCycle(PLAY_MS);
  const [extraMinutes, setExtraMinutes] = useState(0);
  /** Reverse order on reset: later elements leave first. */
  const out = (rank: number) => rank * 32;

  const [typingIn] = useSpring(
    () => ({
      from: { v: 0 },
      to: { v: on && !reduced ? 1 : 0 },
      delay: on ? AT.typing : 0,
      config: SPRING,
      immediate: !on || snap,
    }),
    [on, snap],
  );
  const [typingOut] = useSpring(
    () => ({
      from: { v: 1 },
      to: { v: on ? 0 : 1 },
      delay: on ? AT.typingOut : 0,
      config: SPRING,
      immediate: !on || snap,
    }),
    [on, snap],
  );
  // One linear clock drives every dot: each hops, a quarter-hop behind the last.
  const [hops] = useSpring(
    () => ({
      from: { t: 0 },
      to: { t: on ? 1 : 0 },
      delay: on ? AT.typing + 120 : 0,
      config: { duration: HOPS_MS },
      immediate: !on || snap,
    }),
    [on, snap],
  );
  const [message] = useSpring(
    () => ({
      from: RISE_FROM,
      to: on ? RISE_TO : RISE_FROM,
      delay: on ? AT.message : out(6),
      config: SPRING,
      immediate: snap,
    }),
    [on, snap],
  );
  const [fields] = useSprings(
    approval.fields.length,
    (i) => ({
      from: RISE_FROM,
      to: on ? RISE_TO : RISE_FROM,
      delay: on ? AT.fields + i * AT.fieldStep : out(5 - i),
      config: SPRING,
      immediate: snap,
    }),
    [on, snap],
  );
  const [bar] = useSpring(
    () => ({
      from: { scaleY: 0 },
      to: { scaleY: on ? 1 : 0 },
      delay: on ? AT.bar : out(2),
      config: on ? SPRING_SOFT : SPRING,
      immediate: snap,
    }),
    [on, snap],
  );
  const [buttons] = useSprings(
    3,
    (i) => ({
      from: RISE_FROM,
      to: on ? RISE_TO : RISE_FROM,
      delay: on ? AT.buttons + i * 0.8 * STEP : out(2 - i),
      config: SPRING,
      immediate: snap,
    }),
    [on, snap],
  );

  // Waiting clock: +1 min every TICK_MS once the buttons are up; back to the
  // Figma value while the card resets.
  useEffect(() => {
    if (reduced) return;
    if (!on) {
      const back = window.setTimeout(() => setExtraMinutes(0), 280);
      return () => window.clearTimeout(back);
    }
    let tick = 0;
    const start = window.setTimeout(() => {
      tick = window.setInterval(
        () => setExtraMinutes((m) => Math.min(MAX_TICKS, m + 1)),
        TICK_MS,
      );
    }, TICK_AT);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(tick);
    };
  }, [on, reduced]);

  const waiting = approval.waiting.replace(/\d+/, (m) =>
    String(Number(m) + extraMinutes),
  );

  return (
    <figure
      ref={ref}
      className={`${CARD} h-82 w1024:h-80 w768:h-80.25 w390:h-72.25`}
    >
      <p className="absolute top-7.75 left-7.75 text-label leading-label font-medium whitespace-nowrap text-foreground w1024:top-5.75 w1024:left-5.75 w390:top-4.75 w390:left-4.75 w390:leading-product-small">
        {approval.channel}
      </p>
      <p
        className={`absolute top-7.75 right-7.75 w-30 text-right text-foreground-dim w1024:top-5.75 w1024:right-5.75 w390:top-4.75 w390:right-4.75 ${MONO}`}
      >
        {approval.day}
      </p>
      <span className="absolute top-15.75 left-7.75 h-px w-174 bg-product-card-border w1024:top-13.75 w1024:left-5.75 w1024:w-120 w390:top-11.75 w390:left-4.75 w390:w-77.5" />

      <animated.span
        aria-hidden="true"
        className="absolute top-31 left-17.75 flex gap-1 w1024:top-28.5 w1024:left-15.75 w768:top-31.25 w390:top-26 w390:left-4.75"
        style={{
          opacity: to([typingIn.v, typingOut.v], (a, b) => a * b),
        }}
      >
        {[0, 1, 2].map((i) => (
          <animated.span
            key={i}
            className="block size-1.5 rounded-full bg-foreground-dim"
            style={{ y: hops.t.to((t) => hopY(t, i)) }}
          />
        ))}
      </animated.span>

      <animated.div className="absolute inset-0" style={message}>
        <Image
          src="/brand/cordon-symbol.png"
          alt=""
          width={28}
          height={28}
          className="absolute top-19 left-7.75 size-7 w1024:top-18.75 w1024:left-5.75 w768:top-19 w390:top-14.5 w390:left-4.75"
        />
        <p className="absolute top-20 left-17.75 text-label leading-label font-medium whitespace-nowrap text-foreground w1024:top-19.75 w1024:left-15.75 w768:top-20 w390:top-15.75 w390:left-13.75 w390:leading-product-small">
          {approval.sender}
        </p>
        <p
          className={`absolute top-20 right-7.75 whitespace-nowrap text-foreground-dim w1024:top-19.75 w1024:right-5.75 w768:top-20 w390:top-15.75 w390:right-4.75 ${MONO}`}
        >
          {approval.time}
        </p>
        <p className="absolute top-28.75 left-17.75 w-130 text-body leading-body text-foreground-muted w1024:top-26.25 w1024:left-15.75 w1024:w-110 w768:top-29 w390:top-24.5 w390:left-4.75 w390:w-77.5 w390:text-label w390:leading-product-small">
          {approval.message}
        </p>
      </animated.div>

      <animated.span
        className="absolute top-38.75 left-17.75 h-20 w-0.75 origin-top w1024:top-35.75 w1024:left-15.75 w1024:h-23 w768:top-38 w768:h-20 w390:top-37.5 w390:left-4.75 w390:h-17.5 w390:w-0.5"
        style={bar}
      >
        <Image
          src="/assets/product/product-accent.png"
          alt=""
          width={3}
          height={96}
          className="block h-20 w-0.75 rounded-full w1024:h-23 w768:h-20 w390:h-17.5 w390:w-0.5"
        />
      </animated.span>
      <dl>
        {approval.fields.map((field, i) => (
          <animated.div
            key={field.key}
            className="absolute inset-0"
            style={fields[i]}
          >
            <dt
              className={`absolute left-22 whitespace-nowrap text-foreground-dim w1024:left-20.25 w768:left-18.5 w390:left-7.25 ${MONO} ${FIELD_LAYOUT[i].key}`}
            >
              {field.key}
            </dt>
            <dd
              className={`absolute left-48 font-medium whitespace-nowrap text-foreground w1024:left-43.25 w768:left-41.5 w390:left-29.25 ${FIELD_LAYOUT[i].value}`}
            >
              {field.value}
            </dd>
          </animated.div>
        ))}
      </dl>

      <animated.a
        href="/dashboard/income"
        className={`left-17.75 bg-accent px-4 py-3 text-on-accent w1024:left-15.75 w390:left-4.75 w390:px-3 w390:py-1.5 ${MINI_BUTTON}`}
        style={buttons[0]}
      >
        <Image
          src="/assets/product/product-icon-approve.svg"
          alt=""
          width={14}
          height={14}
          className="size-3.5"
        />
        {approval.approve}
      </animated.a>
      {/* Figma strokes inside the 86 × 44 frame; trim padding by the 1px border. */}
      <animated.a
        href="/docs#encumbrances"
        className={`left-48.5 border border-product-tick bg-surface-raised px-3.75 py-2.75 text-foreground w1024:left-46.5 w390:left-31 w390:px-2.75 w390:py-1.25 ${MINI_BUTTON}`}
        style={buttons[1]}
      >
        <Image
          src="/assets/product/product-icon-hold.svg"
          alt=""
          width={14}
          height={14}
          className="size-3.5"
        />
        {approval.hold}
      </animated.a>
      <animated.p
        className={`absolute top-68.75 right-7.75 w-40 text-right text-foreground-dim tabular-nums w1024:top-65.75 w1024:right-5.75 w768:top-69 w390:top-61.25 w390:right-4.75 ${MONO}`}
        style={buttons[2]}
      >
        {waiting}
      </animated.p>
    </figure>
  );
};
