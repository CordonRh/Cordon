import { SectionHead } from "@/components/ui/section-head";
import type { ScaleContent } from "@/data/mocks/home/scale";

import { RegionsCard } from "./regions-card";
import { RuntimeCard } from "./runtime-card";

/**
 * 06 Scale — four frames: 1440 × 758 (3888:6445), 1024 × 858 (3888:10842),
 * 768 × 1286 (3832:8109), 390 × 1138 (3893:3743).
 * Head at (80, 96) / (48, 80) / (40, 80) / (20, 48); cards at (80, 254) side by
 * side 20 apart / (48, 286) 12 apart / (40, 274) stacked 12 apart / (20, 248)
 * stacked 12 apart.
 */
export const Scale = ({ head, runtime, regions }: ScaleContent) => (
  <section
    id="scale"
    aria-label="Reliability"
    className="[content-visibility:auto] relative h-183.5 w1024:h-214.5 w768:h-321.5 w390:h-284.5"
  >
    <SectionHead
      /* the aside wraps at 516 (1024, 3888:10849) and 514 (768) */
      asideClassName="w1024:w-129! w768:w-128.5! w390:w-85!"
      {...head}
      className="absolute top-24 left-20 w-320 w1024:top-20 w1024:left-12 w1024:w-232 w768:left-10 w768:w-172 w390:top-12 w390:left-5 w390:w-87.5"
    />
    <div className="absolute top-63.5 left-20 flex gap-5 w1024:top-71.5 w1024:left-12 w1024:gap-3 w768:top-68.5 w768:left-10 w768:flex-col w390:top-62 w390:left-5">
      <RuntimeCard {...runtime} index={0} />
      <RegionsCard {...regions} index={1} />
    </div>
  </section>
);
