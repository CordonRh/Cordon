import type { ProductContent } from "@/data/mocks/home/product";

import { FeatureRow } from "./feature-row";
import { TraceCard } from "./trace-card";

/** Row 01 — copy left, `run 41982` trace card right (1440 3888:5822; 1024 3888:10229, 388 tall; 768 545; 390 389). */
export const RowTrace = ({ trace }: Pick<ProductContent, "trace">) => (
  <FeatureRow
    /* 1440 wraps the body at 352 (3888:5826 / 3888:5914), not the full 440 column */
    copyClassName="w-88 w1024:w-85.75 w768:w-88.5 w390:w-87.5"
    index={trace.index}
    title={trace.title}
    body={trace.body}
    visual={<TraceCard trace={trace} />}
    className="h-106 w1024:h-97"
  />
);
