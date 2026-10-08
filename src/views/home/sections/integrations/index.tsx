import { TypeText } from "@/components/ui/type-text";
import type { IntegrationsContent } from "@/data/mocks/home/integrations";

import { IntegrationsRelay } from "./relay";

/**
 * 03 Integrations — 1440 × 354 (Figma 3888:5781) / 1024 × 212 (3888:10189) /
 * 768 × 228 (3832:7456) / 390 × 216 (3893:3056).
 * Tiles sit on a 174px pitch from x80 (gap 114) at y160; the dashed rail runs
 * behind them, with the lit segment + packet between slack and stripe.
 * At 1024 the rail is shorter (908 from x58), notion and gmail drop out and the
 * remaining six tiles sit on a 173.6px pitch from x48 at y84; 768 keeps the
 * same six on a 125.6px pitch from x40 at y92. 390 draws four 56px tiles
 * (slack, stripe, postgres, notion) on a 98px pitch from x20 at y96, with the
 * caption centred on two lines.
 * Motion (rail draw → tile pops, relay loop) lives in `relay.tsx`. The
 * frames' lime blooms are dropped (client call): clipped at the section's
 * bottom they drew a glowing hard edge over the particle stream.
 */
export const Integrations = ({
  caption,
  captionLines390,
  apps,
}: IntegrationsContent) => (
  <section
    id="integrations"
    aria-label="Integrations"
    className="[content-visibility:auto] relative h-88.5 w1024:h-53 w768:h-57 w390:h-54 overflow-clip"
  >
    <p className="absolute top-24 left-20 w1024:top-8 w1024:left-12 w768:top-10 w768:left-10 w390:hidden font-mono text-label leading-label whitespace-nowrap text-foreground-muted">
      <TypeText>{caption}</TypeText>
    </p>
    {/* 390: the same copy centred on two lines (3893:3058); each line types in
        turn, since TypeText clips a single line. */}
    <p className="absolute top-8 left-16.25 hidden w-65.25 w390:flex flex-col items-center font-mono text-label leading-label whitespace-nowrap text-foreground-muted">
      <TypeText>{captionLines390[0]}</TypeText>
      <TypeText delay={captionLines390[0].length * 30}>
        {captionLines390[1]}
      </TypeText>
    </p>

    <IntegrationsRelay apps={apps} />
  </section>
);
