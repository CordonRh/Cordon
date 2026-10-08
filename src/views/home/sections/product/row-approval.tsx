import type { ProductContent } from "@/data/mocks/home/product";

import { ApprovalCard } from "./approval-card";
import { FeatureRow } from "./feature-row";

/** Row 02 — Slack-style approval card left, copy right (1440 3888:5867; 1024 3888:10274, 384 tall; 768 545; 390 429 — copy above the card from 768 down). */
export const RowApproval = ({ approval }: Pick<ProductContent, "approval">) => (
  <FeatureRow
    flip
    index={approval.index}
    title={approval.title}
    body={approval.body}
    copyClassName="w768:w-101.5 w390:w-auto"
    visual={<ApprovalCard approval={approval} />}
    className="h-106 w1024:h-96"
    titleClassName="w1024:w-68 w768:w-auto"
  />
);
