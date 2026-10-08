import type { ProofStat } from "@/data/mocks/home/proof";

import { HourBars } from "./hour-bars";
import { ProgressRun } from "./progress-run";
import { Sparkline } from "./sparkline";

interface StatVisualProps {
  kind: ProofStat["visual"];
  dimHours: number;
  /** ms before the visual starts drawing. */
  delay: number;
}

/** Hour bars are 20 wide on a 28 pitch; the dim ones start after the 300-wide
    lit union. At 1024 (3603:4168–70) they are 16 wide on a 20 pitch, after the
    218-wide union — the designer's dim bars are a shade wider than the lit ones.
    768 (3832:8597–99): 12 on a 16 pitch from 174. 390 (3893:4253–55): 18 on
    the lit bars' 22.46 pitch, the last one ending at 310. */
const DIM_HOUR_LEFT = [
  "left-77 w1024:left-55.5 w768:left-43.5 w390:left-[calc(var(--spacing)*61.7692)]",
  "left-84 w1024:left-60.5 w768:left-47.5 w390:left-[calc(var(--spacing)*67.3846)]",
  "left-91 w1024:left-65.5 w768:left-51.5 w390:left-73",
] as const;

/**
 * Mini visual under each stat, 384 × 56 box at frame y480 (278 × 56 at y451
 * in the 1024 frame, 218 × 56 at y443 at 768, 310 wide at 390 — where the
 * progress box is only the 14-tall track):
 * sparkline 3585:29599, hour bars 3585:29609 + 3488:22760–62, progress track 3488:22763.
 */
export const StatVisual = ({ kind, dimHours, delay }: StatVisualProps) => {
  if (kind === "sparkline") return <Sparkline delay={delay} />;

  if (kind === "hours") {
    return (
      <>
        <HourBars delay={delay} />
        {DIM_HOUR_LEFT.slice(0, dimHours).map((left) => (
          <span
            key={left}
            className={`absolute top-5.5 h-8.5 w-5 rounded-proof-hour bg-proof-hour-dim w1024:w-4 w768:w-3 w390:w-4.5 ${left}`}
          />
        ))}
      </>
    );
  }

  return <ProgressRun delay={delay} />;
};
