import { TypeText } from "@/components/ui/type-text";
import type { SignalsContent } from "@/data/mocks/home/signals";
import { STEP } from "@/lib/motion";

import { ClockIcon } from "./clock-icon";
import { WeekHeatmap } from "./week-heatmap";
import {
  TITLE_AFTER,
  TYPED_CLIP,
  Widget,
  WidgetTitle,
  widgetDelay,
} from "./widget";

/**
 * Hour labels sit beside every other bar row (inside the 1px border):
 * 1440 68 / 102 / 136 / 170, 1024 66 / 100 / 134 / 168 (3888:11006…),
 * 768 77 / 117 / 157 / 197 (3865:72…), 390 100 / 134 / 168 / 202 (3928:73…).
 */
const HOUR_TOP = [
  "top-17 w1024:top-16.5 w768:top-19.25 w390:top-25",
  "top-25.5 w1024:top-25 w768:top-29.25 w390:top-33.5",
  "top-34 w1024:top-33.5 w768:top-39.25 w390:top-42",
  "top-42.5 w1024:top-42 w768:top-49.25 w390:top-50.5",
] as const;

/**
 * Widget / this week, run by run — 876 × 256 (3888:6532) / 458 × 258
 * (3888:10936) / 688 × 298 (3865:2) / 350 × 295 with the chip under the
 * title (3928:3).
 */
export const WeekWidget = ({
  title,
  nextRun,
  hours,
  activeHour,
  nextRunNarrow,
  today,
  todayPeak,
  days,
}: SignalsContent["week"]) => (
  <Widget labelledBy="signals-week" order={0} className="h-64 w-219 w1024:h-64.5 w1024:w-114.5 w768:order-5 w768:h-74.5 w768:w-172 w390:h-73.75 w390:w-87.5">
    <WidgetTitle id="signals-week" order={0} className="top-7.25 left-5.75 w1024:top-5.75 w768:top-7.75 w390:top-4.75 w390:left-4.75">
      {title}
    </WidgetTitle>

    <p className="absolute top-5.75 left-163.25 flex items-center gap-2 h-8 w-50.5 overflow-clip rounded-signals-chip border border-signals-chip-border bg-(image:--signals-chip-fill) px-2.75 py-1.25 shadow-float w1024:top-4.25 w1024:left-66 w1024:w-40 w1024:px-1.75 w768:top-5.75 w768:left-122.75 w768:h-9 w768:w-43 w768:pr-3.75 w768:pl-2.75 w390:top-12.75 w390:left-4.75 w390:w-38.5 w390:border-2 w390:pl-2.5">
      <ClockIcon delay={widgetDelay(0) + 240} />
      <span className="font-mono text-label leading-label whitespace-nowrap text-foreground w390:text-signals-chip-390">
        <span className="w1024:hidden">
          <TypeText className={TYPED_CLIP} delay={widgetDelay(0) + 400}>
            {nextRun}
          </TypeText>
        </span>
        <span className="hidden w1024:inline">
          <TypeText className={TYPED_CLIP} delay={widgetDelay(0) + 400}>
            {nextRunNarrow}
          </TypeText>
        </span>
      </span>
    </p>

    <ul aria-hidden="true">
      {hours.map((hour, i) => (
        <li
          key={hour}
          className={`absolute left-5.75 font-mono text-label leading-label whitespace-nowrap w1024:left-7.75 w768:left-5.75 w390:left-4.75 ${HOUR_TOP[i]} ${
            hour === activeHour
              ? "text-foreground-muted"
              : "text-foreground-dim"
          }`}
        >
          <TypeText
            className={TYPED_CLIP}
            delay={widgetDelay(0) + TITLE_AFTER + i * STEP}
          >
            {hour}
          </TypeText>
        </li>
      ))}
    </ul>

    <WeekHeatmap days={days} today={today} todayPeak={todayPeak} />
  </Widget>
);
