"use client";

import { animated, to, useSpring } from "@react-spring/web";

import type { IntegrationsApp } from "@/data/mocks/home/integrations";
import { SPRING_SOFT } from "@/lib/motion";

type AppTileProps = Pick<IntegrationsApp, "name" | "initials"> & {
  /** Label alignment under the tile — first row item hugs left, last hugs right. */
  align: "start" | "center" | "end";
  /** The rail has reached this tile: pop in. */
  shown: boolean;
  /** Lime "active" look (relay pass or rest-state stripe). */
  active: boolean;
  /** Drawn in the 1024 and 768 frames (not notion, gmail). */
  in1024?: boolean;
  /** Drawn in the 390 frame (slack, stripe, postgres, notion). */
  in390?: boolean;
};

/** 390 (3893:3065 …): every label is centred under its tile. */
const CENTRED_390 = "w390:left-1/2 w390:-translate-x-1/2 w390:text-center";

const LABEL_ALIGN: Record<AppTileProps["align"], string> = {
  start: `left-0 text-left ${CENTRED_390}`,
  center: "left-1/2 -translate-x-1/2 text-center",
  // Figma: last label ends at x1360, 2px past the tile's right edge (1358);
  // at 1024 and 768 (3888:10219, 3832:7486) it ends flush with the tile's right edge.
  end: `-right-0.5 w1024:right-0 text-right w390:right-auto ${CENTRED_390}`,
};

/** Show/hide per frame; 1440 draws every tile. */
const frameClass = (in1024: boolean, in390: boolean) =>
  [
    in1024 ? "" : "w1024:hidden",
    in390 === in1024 ? "" : in390 ? "w390:block" : "w390:hidden",
  ]
    .filter(Boolean)
    .join(" ");

/**
 * App tile 60×60 (56×56 at 390) + label (Figma 3888:5789 …5812).
 * The idle and active looks are two stacked layers cross-faded by one spring,
 * so either end state paints exactly one of Figma's two tile styles.
 */
export const AppTile = ({
  name,
  initials,
  align,
  shown,
  active,
  in1024 = true,
  in390 = true,
}: AppTileProps) => {
  const pop = useSpring({
    s: shown ? 1 : 0.8,
    o: shown ? 1 : 0,
    /* hiding only happens off screen (visit reset): jump, so a quick return starts clean */
    immediate: !shown,
    config: SPRING_SOFT,
  });
  const look = useSpring({
    a: active ? 1 : 0,
    config: SPRING_SOFT,
  });
  const idle = look.a.to((a) => 1 - a);

  return (
    <animated.li
      className={`relative size-15 w390:size-14 ${frameClass(in1024, in390)}`}
      style={{ opacity: pop.o }}
    >
      <animated.div
        aria-hidden="true"
        className="relative size-15 w390:size-14 overflow-clip rounded-integrations-tile backdrop-blur-integrations-tile"
        style={{
          /* the active (lime) tile also grows a touch — 6% */
          transform: to([pop.s, look.a], (s, a) => {
            const k = s * (1 + 0.06 * a);
            return k === 1 ? "none" : `scale(${k})`;
          }),
        }}
      >
        <animated.span
          className="absolute inset-0 flex items-center justify-center rounded-integrations-tile border border-integrations-tile-border bg-linear-to-b/srgb from-integrations-tile-from to-integrations-tile-to bg-origin-border text-foreground-muted"
          style={{ opacity: idle }}
        >
          <span className="font-mono text-label w390:text-integrations-initials-390 leading-label tracking-integrations-initials whitespace-nowrap">
            {initials}
          </span>
        </animated.span>
        <animated.span
          className="absolute inset-0 flex items-center justify-center rounded-integrations-tile border border-integrations-active-border bg-(image:--integrations-active-fill) bg-origin-border text-accent"
          style={{ opacity: look.a }}
        >
          <span className="font-mono text-label w390:text-integrations-initials-390 leading-label tracking-integrations-initials whitespace-nowrap">
            {initials}
          </span>
        </animated.span>
      </animated.div>
      <span
        className={`absolute top-19.5 w1024:top-19 w390:top-17 w-20 font-mono text-label leading-label text-foreground-muted ${LABEL_ALIGN[align]}`}
      >
        {name}
      </span>
    </animated.li>
  );
};
