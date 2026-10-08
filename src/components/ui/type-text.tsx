"use client";

import { InviewSeen } from "@/components/ui/inview-seen";
import type { Tags } from "@/types/springs";

export interface TypeTextProps {
  children: string;
  tag?: Tags;
  className?: string;
  /** ms before typing starts. */
  delay?: number;
  /** ms per character. */
  per?: number;
}

const cut = "round(down, calc(var(--typed) * 1ch), 1ch)";

/**
 * Mono label that types itself in, letter by letter (motion brief,
 * shared.mono; the caret block was dropped at the designer's request).
 *
 * Fragment Mono is monospaced, so every glyph is exactly 1ch: a spring runs
 * `--typed` from 0 to the character count and the text is clipped to whole
 * characters with `round(down, …, 1ch)`. The copy stays one intact text node —
 * nothing is split, so screen readers and search see the plain label.
 * The spring overshoots the count by half a character so rounding never
 * drops the last glyph at rest.
 */
export const TypeText = ({
  children,
  tag = "span",
  className = "",
  delay = 0,
  per = 30,
}: TypeTextProps) => (
  <InviewSeen
    tag={tag}
    mode="once"
    className={`relative inline-block ${className}`}
    from={{ "--typed": 0 }}
    to={{ "--typed": children.length + 0.5 }}
    config={{ duration: children.length * per }}
    delayIn={delay}
    style={{ clipPath: `inset(0 calc(100% - ${cut} - 0.1ch) 0 0)` }}
  >
    {children}
  </InviewSeen>
);
