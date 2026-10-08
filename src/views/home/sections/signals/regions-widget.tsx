import { FocusText } from "@/components/ui/focus-text";
import type { SignalsContent } from "@/data/mocks/home/signals";

import { RegionMap } from "./region-map";
import { TEXT_AFTER, Widget, WidgetTitle, widgetDelay } from "./widget";

/**
 * Widget / where it ran — 414 × 244, dotted map with three regions
 * (3888:6640) / 301 × 268 (3888:11045) / 338 × 268 (3865:108) / 350 × 290
 * (3893:3836).
 */
export const RegionsWidget = ({
  title,
  mapLabel,
  markers,
  caption,
}: SignalsContent["regions"]) => (
  <Widget labelledBy="signals-regions" order={4} className="h-61 w-103.5 w1024:h-67 w1024:grow w1024:basis-0 w768:order-1 w768:h-73.5 w768:w-84.5 w768:grow-0 w768:basis-auto w390:h-72.5 w390:w-87.5">
    <WidgetTitle id="signals-regions" order={4} className="top-5.75 left-5.75 w390:top-4.75 w390:left-4.75">
      {title}
    </WidgetTitle>
    <RegionMap
      mapLabel={mapLabel}
      markers={markers}
      delay={widgetDelay(4) + 160}
    />
    <FocusText
      delay={widgetDelay(4) + TEXT_AFTER}
      className="absolute top-48.75 left-5.75 w-91.5 text-body leading-body text-foreground-muted w1024:w-42 w768:top-55.25 w768:w-56.5 w390:top-55.25 w390:left-4.75"
    >
      {caption}
    </FocusText>
  </Widget>
);
