"use client";

import { animated, useSprings } from "@react-spring/web";

import { SPRING_SOFT, STEP } from "@/lib/motion";

import { useCardPlay } from "./use-card-play";

const DIGITS = "0123456789".split("");

/**
 * Row number that rolls like a counter up to its value (motion brief,
 * product.index "Digit roll"). Each digit is a 0–9 strip plus 0…digit,
 * clipped to one line and slid up a full turn onto the final digit, so the
 * resting glyphs sit exactly where the plain text did.
 */
export const RollIndex = ({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) => {
  const { ref, played } = useCardPlay();
  const chars = value.split("");
  const [springs] = useSprings(
    chars.length,
    (i) => ({
      from: { pos: 0 },
      to: { pos: played ? DIGITS.length + Number(chars[i]) : 0 },
      config: SPRING_SOFT,
      delay: played ? 150 + i * STEP : 0,
    }),
    [played],
  );

  return (
    <p ref={ref} className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="flex w768:justify-center">
        {chars.map((char, i) => (
          <span key={i} className="block h-lh overflow-clip">
            <animated.span
              className="block"
              style={{
                transform: springs[i].pos.to(
                  (p) => `translateY(calc(${-p} * 1lh))`,
                ),
              }}
            >
              {[...DIGITS, ...DIGITS.slice(0, Number(char) + 1)].map((d, k) => (
                <span key={k} className="block">
                  {d}
                </span>
              ))}
            </animated.span>
          </span>
        ))}
      </span>
    </p>
  );
};
