import { SectionHead } from "@/components/ui/section-head";
import type { PricingContent } from "@/data/mocks/home/pricing";

import { PlanBoard } from "./plan-board";

/**
 * 09 Pricing — 1440 × 878 (Figma 3888:6967). Head at y0, run meter
 * (1280 × 302) at y158, three plan cards (398 tall, gap 20) at y480.
 *
 * 1024 (3888:11375) is 1120 tall: the head stacks centred in the 928 column at
 * y80, the run meter (928 × 308) sits at y286 and the cards (434 tall, gap 12)
 * at y606.
 *
 * 768 (3876:2) is 1664 tall: head at y40 in the 688 column, run meter
 * (688 × 423) at y238, the cards stacked full width (309 tall, gap 12) at y673.
 *
 * 390 (3893:4285) is 2131 tall: head at y48 in the 350 column, run meter
 * (350 × 542) at y248, the cards stacked (417 / 423 / 417, gap 12) at y802.
 */
export const Pricing = ({ head, meter, tiers }: PricingContent) => (
  <section
    id="pricing"
    aria-label="Pricing"
    className="[content-visibility:auto] relative h-219.5 w1024:h-280 w768:h-417.5 w390:h-532.75"
  >
    <SectionHead
      {...head}
      className="absolute top-0 left-20 w1024:top-20 w1024:left-12 w1024:w-232 w768:top-10 w768:left-10 w768:w-172 w390:top-12 w390:left-5 w390:w-87.5"
    />
    <PlanBoard meter={meter} tiers={tiers} />
  </section>
);
