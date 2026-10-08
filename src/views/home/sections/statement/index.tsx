import type { StatementContent } from "@/data/mocks/home/statement";

import { DotField } from "./dot-field";
import { StatementMark } from "./mark";
import { StatementPlate, StatementType } from "./plate";
import { Ruler } from "./ruler";
import { StatementTitle } from "./title";
import { TIMELINE } from "./use-statement-seen";

/**
 * 05 Statement — lime contrast plate: 1440 × 552 (Figma 3888:5969), 1024 × 528
 * (3888:10366), 768 × 528 (3832:7633), 390 × 371 (3893:3266).
 * Every child sits at its frame coordinate; motion lives in the client
 * leaves (`title`, `mark`, `ruler`, `dot-field`) on one shared timeline that
 * `StatementPlate` starts once the logo transition has opened the plate.
 */
export const Statement = ({
  kicker,
  title,
  caption,
  now,
  hours,
}: StatementContent) => (
  <StatementPlate className="relative h-138 overflow-clip rounded-statement-plate bg-statement-plate w1024:h-132 w390:h-[calc(var(--spacing)*92.75)]">
    <DotField />

    <p className="absolute top-16 left-20 h-5 w-320 text-center font-mono text-statement-kicker leading-statement-kicker text-statement-ink-muted w1024:top-12 w1024:left-12 w1024:w-232 w768:top-10 w768:left-10 w768:w-172 w390:top-5 w390:left-5 w390:h-4 w390:w-87.5">
      <StatementType delay={TIMELINE.kicker}>{kicker}</StatementType>
    </p>

    <StatementTitle lead={title.lead} accent={title.accent} tail={title.tail} />

    <StatementMark />

    <Ruler caption={caption} now={now} hours={hours} />
  </StatementPlate>
);
