import type { ReactNode } from "react";

import { Reveal } from "@/components/ui/reveal";
import { TypeText } from "@/components/ui/type-text";
import { REVEAL, STEP } from "@/lib/motion";

export interface WidgetProps {
  /** id of the widget's h3, used for aria-labelledby. */
  labelledBy: string;
  /** Stagger slot within the section. */
  order: number;
  /** Width / height utilities from the frame. */
  className: string;
  children: ReactNode;
}

/** ms before a widget in stagger slot `order` starts to rise. */
export const widgetDelay = (order: number) => (order + 2) * REVEAL.step;

/** Widget shell — 26 radius, #0c0d0e fill, 7% hairline (3488:22351 et al.). */
export const Widget = ({
  labelledBy,
  order,
  className,
  children,
}: WidgetProps) => (
  <Reveal
    tag="article"
    aria-labelledby={labelledBy}
    delay={widgetDelay(order)}
    className={`relative shrink-0 overflow-clip rounded-signals-widget border border-signals-widget-border bg-signals-widget ${className}`}
  >
    {children}
  </Reveal>
);

/** Title typing offset inside a widget; body copy follows one STEP later. */
export const TITLE_AFTER = 150;
export const TEXT_AFTER = TITLE_AFTER + STEP;

/** Fragment Mono 14/20 caption in color/text-dim — every widget title. */
export const MONO_DIM =
  "font-mono text-label leading-label whitespace-nowrap text-foreground-dim";

/**
 * TypeText clips to `round(down, --typed × 1ch, 1ch)`; at rest the float
 * product can land a hair under the last whole ch (21 × 8.646px → 20ch here)
 * and shave the final glyph. Same clip with a 0.5px nudge before rounding.
 */
export const TYPED_CLIP =
  "[clip-path:inset(0_calc(100%_-_round(down,calc(var(--typed)*1ch_+_0.5px),1ch)_-_0.1ch)_0_0)]!";

/** Widget title that types itself in once its widget has started to rise. */
export const WidgetTitle = ({
  id,
  order,
  className,
  children,
}: {
  id: string;
  order: number;
  className: string;
  children: string;
}) => (
  <h3 id={id} className={`absolute ${className} ${MONO_DIM}`}>
    <TypeText className={TYPED_CLIP} delay={widgetDelay(order) + TITLE_AFTER}>
      {children}
    </TypeText>
  </h3>
);
