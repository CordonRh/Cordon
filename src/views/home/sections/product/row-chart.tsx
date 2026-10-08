import type { ProductContent } from "@/data/mocks/home/product";

import { ChartCard } from "./chart-card";
import { FeatureRow } from "./feature-row";

/** Row 03 — copy left, `runs per weekday` isometric bar chart right (1440 3888:5910, 376 tall — the card flush with the row bottom;
 *  1024 3888:10308, 408; 768 513; 390 403). */
export const RowChart = ({ chart }: Pick<ProductContent, "chart">) => (
  <FeatureRow
    /* 1440 wraps the body at 352 (3888:5826 / 3888:5914), not the full 440 column */
    copyClassName="w-87.75 w1024:w-87 w390:w-87.5"
    index={chart.index}
    title={chart.title}
    body={chart.body}
    visual={<ChartCard chart={chart} />}
    className="h-94 pb-0 w1024:h-88 w1024:pb-0"
  />
);
