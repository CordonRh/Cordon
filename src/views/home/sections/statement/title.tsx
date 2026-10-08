"use client";

import { animated, useSprings } from "@react-spring/web";

import { SPRING, SPRING_SOFT } from "@/lib/motion";

import { TIMELINE, useStatementSeen } from "./use-statement-seen";

export interface StatementTitleProps {
  lead: string;
  accent: string;
  tail: string;
}

/**
 * Dark-ink title: sans words rise one by one, the serif accent lands last
 * with a -16° slant that straightens. Words are inline-blocks separated by
 * the original spaces, so the resting layout is the plain heading.
 */
export const StatementTitle = ({ lead, accent, tail }: StatementTitleProps) => {
  const { seen, reduced } = useStatementSeen();
  const leadWords = lead.split(" ");
  const tailWords = tail.trim().split(" ");
  const count = leadWords.length + tailWords.length + 1;
  const accentIndex = count - 1;

  const [springs] = useSprings(
    count,
    (i) => {
      const isAccent = i === accentIndex;
      const hidden = {
        opacity: 0,
        y: isAccent ? 28 : 22,
        skewX: isAccent ? -16 : 0,
      };
      return {
        from: hidden,
        to: seen ? { opacity: 1, y: 0, skewX: 0 } : hidden,
        delay: reduced ? 0 : TIMELINE.title + i * TIMELINE.titleStep,
        config: isAccent ? SPRING_SOFT : SPRING,
        immediate: reduced || !seen,
      };
    },
    [seen, reduced],
  );

  const word = (text: string, i: number, className = "") => (
    <animated.span
      key={`${text}-${i}`}
      className={`inline-block ${className}`}
      style={springs[i]}
    >
      {text}
    </animated.span>
  );

  return (
    <h2
      id="statement-title"
      className="absolute top-27 left-20 w-320 text-center font-sans text-section-title leading-statement-title font-semibold tracking-title text-on-accent w1024:top-21 w1024:left-12 w1024:w-232 w768:top-19 w768:left-10 w768:w-172 w390:top-12 w390:left-5 w390:w-87.5"
    >
      <span className="block">
        {leadWords.map((w, i) => [i > 0 && " ", word(w, i)])}
      </span>
      <span className="block">
        {word(
          accent,
          accentIndex,
          "origin-bottom-left font-serif text-section-title-accent font-normal italic",
        )}
        {tailWords.map((w, i) => [" ", word(w, leadWords.length + i)])}
      </span>
    </h2>
  );
};
