import type { RefObject } from "react";

import { InviewSeen } from "@/components/ui/inview-seen";
import { TypeText, type TypeTextProps } from "@/components/ui/type-text";

/** The shared clip, restated with +0.5px before rounding (see TypeLabel). */
const CUT = "round(down, calc(var(--typed) * 1ch + 0.5px), 1ch)";

/**
 * TypeText with a sub-pixel nudge on its clip. The shared clip rounds
 * `--typed × 1ch` down to whole characters, and at 8.645px/ch `7 × 1ch`
 * lands a hair under 7ch — so "a month" rests with its last glyph cut. The
 * important class restates the same clip with +0.5px before rounding.
 *
 * With `trigger`, the typing runs off that element being seen instead of the
 * label itself — TypeText's markup and timing, driven by the card: at 1440 the
 * pinned section is covered by the footer before a card's period line ever
 * reaches the view line.
 */
export const TypeLabel = ({
  className = "",
  trigger,
  ...props
}: TypeTextProps & { trigger?: RefObject<HTMLElement> }) => {
  if (!trigger)
    return (
      <TypeText
        {...props}
        className={`[clip-path:inset(0_calc(100%_-_round(down,calc(var(--typed)*1ch_+_0.5px),1ch)_-_0.1ch)_0_0)]! ${className}`}
      />
    );

  const { children, tag = "span", delay = 0, per = 30 } = props;
  return (
    <InviewSeen
      tag={tag}
      mode="once"
      trigger={trigger}
      className={`relative inline-block ${className}`}
      from={{ "--typed": 0 }}
      to={{ "--typed": children.length + 0.5 }}
      config={{ duration: children.length * per }}
      delayIn={delay}
      style={{ clipPath: `inset(0 calc(100% - ${CUT} - 0.1ch) 0 0)` }}
    >
      {children}
    </InviewSeen>
  );
};
