import { DrawLine } from "@/components/ui/draw-line";
import { SectionHead } from "@/components/ui/section-head";
import type { ProductContent } from "@/data/mocks/home/product";

import { RowApproval } from "./row-approval";
import { RowChart } from "./row-chart";
import { RowTrace } from "./row-trace";

/** Hairline between blocks, draws from the left — 1280 × 1, white 9% (3488:21998, 22043, 22077). */
const Hairline = ({ className = "" }: { className?: string }) => (
  <DrawLine className={`h-px shrink-0 bg-product-hairline ${className}`} />
);

/**
 * 04 Product — 1440 × 1593, content 1280 from x80 y96 (Figma 3888:5813).
 * Head (174) → hairline → rows of 424 / 424 / 376 split by hairlines; 96 below.
 *
 * 1024 (3888:10220) — 1509 tall, content 928 from x48 y40: the head stacks
 * centred (206), then rows of 388 / 384 / 408 and 80 below.
 *
 * 768 (3832:7487) — 2000 tall, content 688 from x40 y40: head 178, every
 * block 16 apart, rows stack copy over card (545 / 545 / 513), 80 below.
 *
 * 390 (3893:3087) — 1680 tall, content 350 from x20 y48: blocks 32 apart,
 * rows 389 / 429 / 403, 48 below.
 */
export const Product = ({ head, trace, approval, chart }: ProductContent) => (
  <section
    id="product"
    aria-label="Product"
    className="[content-visibility:auto] relative flex h-398.25 flex-col px-page-inset pt-24 w1024:h-373.25 w1024:pt-20 w768:h-500 w768:pt-11 w768:gap-4 w390:h-403.5 w390:gap-8 w390:pt-12"
  >
    <SectionHead
      stackClassName="w768:gap-4"
      asideClassName="w1024:w-120! w768:w-130! w390:w-full!"
      badge={head.badge}
      title={head.title}
      aside={head.aside}
      className="pb-16 w1024:pb-8 w768:pb-4 w390:pb-0"
    />
    <Hairline />
    <RowTrace trace={trace} />
    {/* 390 has no hairline between rows (3893:3087) */}
    <Hairline className="w390:hidden" />
    <RowApproval approval={approval} />
    <Hairline className="w390:hidden" />
    <RowChart chart={chart} />
  </section>
);
