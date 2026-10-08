"use client";

import { animated, easings } from "@react-spring/web";

import { loopFade, phase, useProofLoop } from "./use-proof-loop";

/** Cycle clock, ms: run to 99 %, pause, stumble back, push the last 1 %. */
const RUN = 880;
const STUMBLE_AT = RUN + 176;
const STUMBLE = 128;
const FINISH_AT = STUMBLE_AT + STUMBLE + 96;
const FINISH = 336;
const PLAY = FINISH_AT + FINISH;

const fill = (t: number) => {
  if (t < STUMBLE_AT) return 0.99 * easings.easeOutCubic(phase(t, 0, RUN));
  if (t < FINISH_AT)
    return 0.99 - 0.018 * easings.easeOutQuad(phase(t, STUMBLE_AT, STUMBLE));
  return 0.972 + 0.028 * easings.easeInOutCubic(phase(t, FINISH_AT, FINISH));
};

/**
 * First-attempt track 3488:22763: the fill runs to 99 %, stumbles back a
 * touch, then pushes the last 1 % — "the other 1% retried and passed"
 * (motion brief, proof "Draw in"). Revealed with clip-path so the gradient
 * stays put and the resting frame is the full Figma fill. Loops while on
 * screen: run, hold full, fade the fill out, run again (the track stays).
 */
export const ProgressRun = ({ delay = 0 }: { delay?: number }) => {
  const { ref, t } = useProofLoop<HTMLDivElement>(PLAY, delay);

  return (
    // The observed box is the whole 384 × 56 visual, like the other two, so
    // all three start on the same line (the track itself sits 20 px lower).
    <div ref={ref} className="absolute inset-0">
      {/* 1024 (3888:11347) / 768 (3832:8600): 278 / 218 wide, one px lower
          inside the 56-tall box. 390 (3893:4256): the box is the 310 track. */}
      <div className="absolute top-5 left-0 h-3.5 w-96 overflow-clip rounded-full bg-proof-track w1024:top-5.25 w1024:w-69.5 w768:w-54.5 w390:top-0 w390:w-77.5">
        <animated.div
          className="size-full bg-linear-[175.82deg] w1024:bg-linear-[174.24deg] w768:bg-linear-[172.67deg] w390:bg-linear-[174.83deg] from-proof-fill-from from-[27.819%] to-proof-fill-to to-[66.696%]"
          style={{
            opacity: t.to((v) => loopFade(v, PLAY)),
            // At rest the clip is dropped so the track's own rounding is the
            // only edge (a second rounded clip darkens the anti-aliasing).
            clipPath: t.to((v) => {
              const p = fill(v);
              return p >= 1
                ? "none"
                : `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0 round 999px)`;
            }),
          }}
        />
      </div>
    </div>
  );
};
