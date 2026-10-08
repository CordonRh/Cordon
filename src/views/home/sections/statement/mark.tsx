"use client";

import { animated, useSpring } from "@react-spring/web";
import Image from "@/components/compat/image";
import { useEffect, useState } from "react";

import { SPRING, SPRING_SOFT } from "@/lib/motion";

import { DROP, TIMELINE, useStatementSeen } from "./use-statement-seen";

/**
 * App tile 3488:22130 + drop line 3488:22135 — "pinned in": the tile drops
 * 40px and lands with a small overshoot, the stem grows down to "now". While
 * in view the chevrons take a short step forward and back every ~4 s.
 */
export const StatementMark = () => {
  const { seen, inView, reduced } = useStatementSeen();
  const [step, setStep] = useState(false);

  const tile = useSpring({
    from: { y: -40, opacity: 0 },
    to: seen ? { y: 0, opacity: 1 } : { y: -40, opacity: 0 },
    delay: reduced ? 0 : TIMELINE.tile,
    config: (key: string) => (key === "opacity" ? SPRING : DROP),
    immediate: reduced || !seen,
  });

  const stem = useSpring({
    from: { scaleY: 0 },
    to: { scaleY: seen ? 1 : 0 },
    delay: reduced ? 0 : TIMELINE.stem,
    config: SPRING_SOFT,
    immediate: reduced || !seen,
  });

  const chevrons = useSpring({ x: step ? 5 : 0, config: SPRING });

  useEffect(() => {
    if (!seen || !inView || reduced) return;
    let back: ReturnType<typeof setTimeout> | undefined;
    const nudge = () => {
      setStep(true);
      back = setTimeout(() => setStep(false), 200);
    };
    const id = setInterval(nudge, TIMELINE.chevronEvery);
    return () => {
      clearInterval(id);
      clearTimeout(back);
      setStep(false);
    };
  }, [seen, inView, reduced]);

  return (
    <>
      <animated.div
        style={tile}
        data-statement-mark=""
        className="absolute top-73 left-170.5 size-19 w1024:top-58 w1024:left-118.5 w768:top-51 w768:left-86.5 w390:top-44 w390:left-39.25"
      >
        <div className="relative size-full overflow-clip rounded-statement-mark border border-statement-mark-border bg-linear-135/srgb from-statement-mark-from to-on-accent to-[71.429%]">
          <animated.div style={chevrons} className="absolute inset-0">
            <Image
              src="/brand/cordon-symbol.png"
              alt=""
              width={34}
              height={37}
              className="absolute top-[calc(var(--spacing)*4.6175)] left-[calc(var(--spacing)*5.3675)] h-[calc(var(--spacing)*9.265)] w-[calc(var(--spacing)*8.3825)] max-w-none"
            />
          </animated.div>
        </div>
      </animated.div>

      <animated.span
        aria-hidden="true"
        style={stem}
        className="absolute top-92 left-180 h-25.5 w-px origin-top bg-linear-to-b/srgb from-statement-stem-from to-statement-stem-to w1024:top-77 w1024:left-128 w1024:h-34.5 w768:top-72 w768:left-96 w768:h-39 w390:top-63 w390:left-48.75 w390:h-12"
      />
    </>
  );
};
