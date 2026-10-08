import { SectionHead } from "@/components/ui/section-head";
import type { SignalsContent } from "@/data/mocks/home/signals";

import { FailuresWidget } from "./failures-widget";
import { HandsOffWidget } from "./hands-off-widget";
import { RegionsWidget } from "./regions-widget";
import { WaitingWidget } from "./waiting-widget";
import { WeekWidget } from "./week-widget";

/**
 * 07 Signals — five widgets under the shared head.
 *
 * 1440 (3888:6522, 774): head at (80, 96), Row A (876 + 384) at y254 and
 * Row B (413 + 413 + 414) 20 below it.
 * 1024 (3888:10926, 784): head stacked at (48, 0), widgets at (48, 206) in
 * 12 gaps — Row A two 458 halves, Row B three equal thirds.
 * 768 (3832:8181, 1138): head at (40, 40), widgets at (40, 234) regrouped
 * into a 2-up grid — where it ran | hands off, waiting | failures — with the
 * full-width week widget last.
 * 390 (3893:3826, 1401): head at (20, 0), widgets at (20, 200), one column:
 * where it ran, hands off, waiting, week. Failures is not in that frame.
 *
 * The two row wrappers dissolve (`contents`) at 768 and below so the widgets
 * reflow through one wrap container and `order`.
 */
export const Signals = ({
  head,
  week,
  handsOff,
  waiting,
  failures,
  regions,
}: SignalsContent) => (
  <section
    id="signals"
    aria-label="Daily view"
    className="[content-visibility:auto] relative h-193.5 w1024:h-196 w768:h-284.5 w390:h-350.25"
  >
    <SectionHead
      asideClassName="w1024:w-123.5! w768:w-125.5! w390:w-82!"
      {...head}
      className="absolute top-24 left-20 w-320 w1024:top-0 w1024:left-12 w1024:w-232 w768:top-10 w768:left-10 w768:w-172 w390:top-0 w390:left-5 w390:w-87.5"
    />
    <div className="absolute top-63.5 left-20 flex w-320 flex-col gap-5 w1024:top-51.5 w1024:left-12 w1024:w-232 w1024:gap-3 w768:top-58.5 w768:left-10 w768:w-172 w768:flex-row w768:flex-wrap w768:items-start w390:top-50 w390:left-5 w390:w-87.5 w390:flex-col">
      <div className="flex gap-5 w1024:gap-3 w768:contents">
        <WeekWidget {...week} />
        <HandsOffWidget {...handsOff} />
      </div>
      <div className="flex gap-5 w1024:gap-3 w768:contents">
        <WaitingWidget {...waiting} />
        <FailuresWidget {...failures} />
        <RegionsWidget {...regions} />
      </div>
    </div>
  </section>
);
