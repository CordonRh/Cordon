"use client";

import { animated, useSpring } from "@react-spring/web";
import { useEffect, useRef, useState } from "react";

import { SPRING_SOFT, STEP } from "@/lib/motion";

/** SPRING_SOFT ~20% quicker: tension ×1.5, friction ×√1.5 keeps its damping. */
const SOFT_FAST = {
  tension: SPRING_SOFT.tension * 1.5,
  friction: SPRING_SOFT.friction * 1.22,
} as const;

/** Row 10 of each strip is empty — a column that the current price doesn't use. */
const BLANK = 10;
const ROWS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", " "];
/** Zero-width text keeps a line box (and so the baseline) in an empty column. */
const ZWSP = "\u200b";

const Digit = ({
  value,
  delay,
  widths,
}: {
  value: number;
  delay: number;
  widths: readonly number[] | null;
}) => {
  const target = widths ? (value === BLANK ? 0 : widths[value]) : 0;
  /* the first measured width is applied as-is; only later changes spring */
  const primed = useRef(false);
  useEffect(() => {
    if (widths) primed.current = true;
  }, [widths]);
  const { d, w } = useSpring({
    d: value,
    w: target,
    delay: (key: string) => (key === "w" && !primed.current ? 0 : delay),
    config: SOFT_FAST,
    /* before the glyphs are measured the column sizes itself */
    immediate: (key) => key === "w" && !primed.current,
  });

  return (
    <animated.span
      className="relative inline-block"
      style={{ width: widths ? w.to((v) => `${v}px`) : undefined }}
    >
      {/* Sizer: the real digit in flow keeps the Figma advance and baseline. */}
      <span className="text-transparent">
        {value === BLANK ? ZWSP : ROWS[value]}
      </span>
      <span className="absolute inset-0 overflow-clip">
        <animated.span
          className="absolute inset-x-0 flex flex-col"
          style={{ top: d.to((v) => `${-v * 100}%`) }}
        >
          {ROWS.map((row, n) => (
            <span key={n} className="block">
              {row}
            </span>
          ))}
        </animated.span>
      </span>
    </animated.span>
  );
};

/**
 * Price that rolls digit by digit, left to right, when the plan changes
 * (motion brief, pricing slider). Digits are right-aligned into as many
 * columns as the longest price needs; unused leading columns are empty rows.
 * Each column also springs its width to the glyph it lands on (measured once
 * the font is ready), so the price — and the "a month" beside it — glide to
 * the new length instead of jumping, and a column that empties closes
 * without its digits spilling over the next one. The strips move with `top`
 * (layout, not a transform) so the resting glyphs rasterise like plain text.
 */
export const PriceRoll = ({
  price,
  prices,
  className = "",
}: {
  price: string;
  prices: readonly string[];
  className?: string;
}) => {
  const columns = Math.max(...prices.map((p) => p.replace(/\D/g, "").length));
  const prefix = price.replace(/\d/g, "");
  const digits = price.replace(/\D/g, "").padStart(columns, "x");

  const probe = useRef<HTMLSpanElement>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => {
      const el = probe.current;
      if (!live || !el) return;
      setWidths(
        [...el.children].map((child) => child.getBoundingClientRect().width),
      );
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <span className={`relative whitespace-nowrap ${className}`}>
      <span className="sr-only">{price}</span>
      <span aria-hidden="true">
        {prefix}
        {[...digits].map((ch, n) => (
          <Digit
            key={n}
            value={ch === "x" ? BLANK : Number(ch)}
            delay={n * 0.8 * STEP}
            widths={widths}
          />
        ))}
      </span>
      <span
        ref={probe}
        aria-hidden="true"
        className="invisible absolute top-0 left-0"
      >
        {ROWS.slice(0, BLANK).map((row) => (
          <span key={row} className="inline-block">
            {row}
          </span>
        ))}
      </span>
    </span>
  );
};
