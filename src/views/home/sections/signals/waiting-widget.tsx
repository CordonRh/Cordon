import { FocusText } from "@/components/ui/focus-text";
import type { SignalsContent } from "@/data/mocks/home/signals";

import { FaceStack } from "./face-stack";
import { TEXT_AFTER, Widget, WidgetTitle, widgetDelay } from "./widget";

/**
 * Widget / waiting on people — 413 × 244, five overlapping faces (3888:6615)
 * / 301 × 268 (3888:11020) / 338 × 248 with 44 faces (3865:85) / 350 × 290
 * with 60 faces (3925:12628).
 */
export const WaitingWidget = ({
  title,
  faces,
  count,
  countLabel,
  note,
}: SignalsContent["waiting"]) => (
  <Widget labelledBy="signals-waiting" order={2} className="h-61 w-103.25 w1024:h-67 w1024:grow w1024:basis-0 w768:order-3 w768:h-62 w768:w-84.5 w768:grow-0 w768:basis-auto w390:h-72.5 w390:w-87.5">
    <WidgetTitle id="signals-waiting" order={2} className="top-5.75 left-5.75 w390:top-4.75 w390:left-4.75">
      {title}
    </WidgetTitle>
    <FaceStack
      faces={faces}
      count={count}
      countLabel={countLabel}
      delay={widgetDelay(2) + 160}
    />
    <FocusText
      delay={widgetDelay(2) + TEXT_AFTER}
      className="absolute top-48.75 left-5.75 w-91.25 text-body leading-body text-foreground-muted w1024:w-63.25 w768:top-49.75 w768:w-72.5 w390:top-61.25 w390:left-4.75"
    >
      {note}
    </FocusText>
  </Widget>
);
