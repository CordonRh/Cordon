"use client";

import { animated, type SpringValue, useSpring } from "@react-spring/web";
import Image from "@/components/compat/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { IntegrationsApp } from "@/data/mocks/home/integrations";
import { type Frame, pick, useFrame } from "@/hooks/use-frame";
import { SPRING_SOFT } from "@/lib/motion";

import { VIEW_MARGIN } from "@/lib/view";

import { AppTile } from "./app-tile";

/* Geometry in section px, one set per Figma frame: the designer re-laid the
   rail out in each (tile count, pitch, rail length, inset). `useFrame()` uses
   the same lines as the `w1024:` / `w768:` / `w390:` variants, so the CSS
   layout and the motion constants can never disagree. */
type Rail = {
  /** Tile edge length. */
  tile: number;
  /** First tile's left edge. */
  tileX: number;
  /** Tile-to-tile pitch. */
  pitch: number;
  /** Rail's left edge and length. */
  railX: number;
  railW: number;
  /** Packet centre at rest (between slack and stripe). */
  rest: number;
  /** Lit trail around the packet centre, as Figma draws it at rest. */
  /** Phase of the rail's 2/8 dashes, matching the exported rail asset. */
  dashOffset: number;
};

/** 1440 — Figma 3488:21958 (Rail 3488:21962, Rail / active 3488:21964). */
const WIDE: Rail = {
  tile: 60,
  tileX: 80,
  pitch: 174,
  railX: 90,
  railW: 1260,
  rest: 217,
  dashOffset: 1,
};

/** 1024 — Figma 3603:3037 (Rail 3603:3041, Rail / active 3603:3043).
    Tiles run 48 → 916 in five steps, so the pitch is 173.6. */
const NARROW: Rail = {
  tile: 60,
  tileX: 48,
  pitch: 173.6,
  railX: 58,
  railW: 908,
  rest: 165,
  dashOffset: 0,
};

/** 768 — Figma 3832:7456 (Rail 3832:7459, Rail / active 3832:7461).
    Same six tiles as 1024; they run 40 → 668, so the pitch is 125.6. */
const TABLET: Rail = {
  tile: 60,
  tileX: 40,
  pitch: 125.6,
  railX: 50,
  railW: 668,
  rest: 133,
  dashOffset: 0,
};

/** 390 — Figma 3893:3056 (Rail 3893:3059, Rail / active 3893:3061).
    Four 56px tiles (slack, stripe, postgres, notion) on a 98px pitch; the rail
    runs 28 → 362 with no scroll or wrap. */
const PHONE: Rail = {
  tile: 56,
  tileX: 20,
  pitch: 98,
  railX: 28,
  railW: 334,
  rest: 97,
  dashOffset: 0,
};

/** Is the app drawn in this frame? (the row hides the rest with classes) */
const drawnIn = (frame: Frame, app: IntegrationsApp) =>
  pick(frame, { 1440: true, 1024: app.in1024, 390: app.in390 });

/** Tile centre in section px. */
const center = (g: Rail, i: number) => g.tileX + i * g.pitch + g.tile / 2;
const tileLeft = (g: Rail, i: number) => g.tileX + i * g.pitch;

/** Reveal: rail draw, ms (slowed for readability). */
const DRAW_MS = 1760;
const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

/*
 * Relay lap — one smooth, never-stopping glide: from the Figma rest spot the
 * packet eases off and slides along the whole row at an even pace, slowing
 * only into "+"; each tile lights while the packet is nearest to it (the tile
 * look is its own soft spring, so tiles hand over without a jump). At "+" it
 * fades, reappears inside slack already moving, and runs the row again —
 * steps 2 → 4 repeat, it never parks. A timer walks the steps; each step is a
 * spring goal.
 */
type Step = {
  x: number;
  o: number;
  /** Tile shown active during this step; `null` follows the packet. */
  active: number | null;
  /** Travel / fade time, ms. */
  move: number;
  /** Time until the next step, ms. */
  wait: number;
  jump?: boolean;
  easing?: (t: number) => number;
  /** Opacity fade time, ms, when it differs from `move`. */
  fade?: number;
};

/** The run across the whole row, ms — the same in every frame. */
const RUN = 5600;
/**
 * Eases in over the first stretch, then cruises at an even speed all the way
 * into "+" — no slow crawl at the end, so the packet visibly reaches the last
 * tile and disappears under its frost.
 */
const EASE_IN = 0.18;
const glide = (t: number) => {
  /* quadratic ease-in joined to a line with matching slope at EASE_IN */
  const k = 1 / (1 - EASE_IN / 2);
  return t < EASE_IN ? (k * t * t) / (2 * EASE_IN) : k * (t - EASE_IN / 2);
};

const lap = (g: Rail, count: number): Step[] => {
  const end = center(g, count - 1);
  const start = center(g, 0);
  /* same pace in every frame: the whole row takes RUN */
  return [
    { x: start, o: 0, active: 0, move: 0, wait: 30, jump: true },
    {
      x: end,
      o: 1,
      active: null,
      move: RUN,
      fade: 360,
      wait: RUN + 200,
      easing: glide,
    },
    { x: end, o: 0, active: count - 1, move: 360, wait: 380 },
  ];
};

/** After the last step the lap starts over from under slack. */
const LOOP_FROM = 0;

/** The tile the packet has reached: it lights as the packet gets to its edge. */
const nearest = (g: Rail, count: number, x: number) =>
  Math.min(
    count - 1,
    Math.max(0, Math.floor((x - g.tileX + g.tile * 0.4) / g.pitch)),
  );

type RailLayersProps = {
  geometry: Rail;
  drawP: SpringValue<number>;
  packetX: SpringValue<number>;
  packetO: SpringValue<number>;
};

/**
 * Rail + packet, all in section px. The rail is one dashed line (2/8) whose
 * colour is a moving gradient, as Figma's Rail now draws it (3888:5786):
 * grey → lime right under the packet → grey, the lime peak riding along with
 * the packet (10% of the rail behind it, the rest ahead). The separate lit
 * segment (Rail / active) is gone. While the packet fades, the peak fades
 * back to grey with it.
 */
const RAIL_BACK = 0.1001;

/**
 * A horizontal mask with a hole under every tile: the rail and the packet are
 * never painted where a tile sits, so nothing shows through a tile while it
 * is still fading in (a half-transparent tile has no working frost yet).
 */
const underTiles = (g: Rail, count: number, width: number) => {
  const pc = (v: number) => `${((v / width) * 100).toFixed(3)}%`;
  const stops = ["black 0%"];
  for (let i = 0; i < count; i++) {
    const l = g.tileX + i * g.pitch;
    stops.push(
      `black ${pc(l)}`,
      `transparent ${pc(l)}`,
      `transparent ${pc(l + g.tile)}`,
      `black ${pc(l + g.tile)}`,
    );
  }
  stops.push("black 100%");
  return `linear-gradient(to right, ${stops.join(", ")})`;
};

const RailLayers = ({
  geometry,
  drawP,
  packetX,
  packetO,
  count,
  frame,
}: RailLayersProps & { count: number; frame: Frame }) => {
  const { railX, railW, rest, dashOffset } = geometry;
  const mask = underTiles(geometry, count, frame);
  const at = (x: number) => (x - railX) / railW;
  const from = (x: number) => Math.max(0, at(x) - RAIL_BACK);
  const peak = (x: number) => Math.min(1, Math.max(0, at(x)));
  const to = (x: number) => Math.min(1, at(x) + (1 - RAIL_BACK));
  const idle = {
    stopColor: "var(--integrations-rail-idle)",
    stopOpacity: "var(--integrations-rail-alpha)",
  };

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      <animated.div
        className="absolute top-47.5 left-22.5 h-0.5 w-315 w1024:top-28.5 w1024:left-14.5 w1024:w-227 w768:top-30.25 w768:left-12.5 w768:w-167 w390:top-30.75 w390:left-7 w390:w-83.5"
        style={{
          clipPath: drawP.to((p) =>
            p >= 1 ? "none" : `inset(0 ${(1 - p) * 100}% 0 0)`,
          ),
        }}
      >
        <animated.svg
          aria-hidden="true"
          width={railW}
          height={2}
          viewBox={`0 0 ${railW} 2`}
          preserveAspectRatio="none"
          className="block h-0.5 w-full overflow-visible"
          style={{ "--lit": packetO } as unknown as CSSProperties}
        >
          <defs>
            <linearGradient
              id="integrations-rail"
              x1="0"
              y1="1"
              x2={railW}
              y2="1"
              gradientUnits="userSpaceOnUse"
            >
              <animated.stop offset={packetX.to(from)} style={idle} />
              <animated.stop
                offset={packetX.to(peak)}
                style={{
                  stopColor:
                    "color-mix(in srgb, var(--integrations-rail-lit) calc(var(--lit) * 100%), var(--integrations-rail-idle))",
                  stopOpacity: "var(--integrations-rail-alpha)",
                }}
              />
              <animated.stop offset={packetX.to(to)} style={idle} />
            </linearGradient>
          </defs>
          <path
            d={`M0 1H${railW}`}
            stroke="url(#integrations-rail)"
            strokeDasharray="2 8"
            strokeDashoffset={dashOffset}
          />
        </animated.svg>
      </animated.div>
      <animated.div
        className="absolute top-47 left-53.5 size-1.5 w1024:top-28 w1024:left-40.5 w768:top-29.75 w768:left-32.5 w390:top-30.25 w390:left-23.5"
        style={{
          opacity: packetO,
          /* design px → rem (16 design px per rem in every frame), so the
             packet scales with the page like the rail and the lit trail do */
          transform: packetX.to((x) =>
            x === rest ? "none" : `translateX(${(x - rest) / 16}rem)`,
          ),
        }}
      >
        <Image
          src="/assets/integrations/integrations-packet.svg"
          alt=""
          width={6}
          height={6}
          className="block size-1.5"
        />
      </animated.div>
    </div>
  );
};

export const IntegrationsRelay = ({
  apps,
}: {
  apps: readonly IntegrationsApp[];
}) => {
  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLUListElement>(null);
  /** Loop gate: some of the section on screen (no margin). */
  const [inView, setInView] = useState(false);
  /** Entrance gate: the rail draw starts once the section is properly in view. */
  const [started, setStarted] = useState(false);
  const [reduced, setReduced] = useState(false);
  /** Active Figma frame — picks the geometry set and which tiles are drawn. */
  const frame = useFrame();
  const [drawn, setDrawn] = useState(0);
  /** Lap step, or -1 while idle (before the draw finishes / reduced motion). */
  const [step, setStep] = useState(-1);

  const geometry = pick(frame, {
    1440: WIDE,
    1024: NARROW,
    768: TABLET,
    390: PHONE,
  });
  /* Position of each app in the rail in this frame, or -1 when it is not drawn
     there (the row hides it with `w1024:hidden` / `w390:hidden`). */
  const lanes = useMemo(() => {
    let next = 0;
    return apps.map((a) => (drawnIn(frame, a) ? next++ : -1));
  }, [apps, frame]);
  const count = useMemo(
    () => lanes.reduce((n, l) => (l >= 0 ? n + 1 : n), 0),
    [lanes],
  );
  /** The tile Figma shows active at rest (stripe). */
  const restTile = Math.max(0, lanes[apps.findIndex((a) => a.active)] ?? 0);
  const steps = useMemo(() => lap(geometry, count), [geometry, count]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    /* Fully off screen: back to the undrawn idle state, so the next visit
       replays the draw, the pops and a first lap from the start. */
    const io = new IntersectionObserver(([e]) => {
      setInView(e.isIntersecting);
      if (e.isIntersecting) return;
      setStarted(false);
      setDrawn(0);
      setStep(-1);
    });
    io.observe(el);
    const seen = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setStarted(true);
      },
      { rootMargin: VIEW_MARGIN },
    );
    seen.observe(el);
    /* A tall first screen can show the whole tile row while the section sits
       just under VIEW_MARGIN — start there too, but only for the initial
       layout; while scrolling, VIEW_MARGIN alone decides. */
    const rowSeen = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setStarted(true);
        rowSeen.disconnect();
      },
      { threshold: 1 },
    );
    if (row.current) rowSeen.observe(row.current);
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncRm = () => setReduced(rm.matches);
    syncRm();
    rm.addEventListener("change", syncRm);
    return () => {
      io.disconnect();
      seen.disconnect();
      rowSeen.disconnect();
      rm.removeEventListener("change", syncRm);
    };
  }, []);

  /* Reveal: the rail draws left → right; tiles pop as the line reaches them. */
  const draw = useSpring({
    p: started ? 1 : 0,
    config: { duration: DRAW_MS, easing: easeInOut },
    immediate: !started,
    onChange: ({ value }) => {
      const edge = geometry.railX + value.p * geometry.railW;
      let n = 0;
      while (n < count && tileLeft(geometry, n) <= edge) n++;
      setDrawn((d) => Math.max(d, n));
    },
  });

  useEffect(() => {
    if (!started || reduced) return;
    /* the relay starts at once, out from under slack, while the rail draws */
    setStep((k) => (k < 0 ? 0 : k));
    const t = setTimeout(() => setDrawn(count), DRAW_MS + 160);
    return () => clearTimeout(t);
  }, [started, reduced, count]);

  /* Crossing a breakpoint swaps the lap for a shorter/longer one — restart
     it rather than index past its end. */
  useEffect(() => {
    setStep((k) => (k >= steps.length ? 0 : k));
    setDrawn((d) => Math.min(d, count));
  }, [steps.length, count]);

  /* Relay timeline — runs by itself while in view, never with reduced motion. */
  useEffect(() => {
    if (reduced) {
      setStep(-1);
      return;
    }
    if (step < 0 || step >= steps.length || !inView) return;
    const t = setTimeout(() => {
      setStep(step + 1 < steps.length ? step + 1 : LOOP_FROM);
    }, steps[step].wait);
    return () => clearTimeout(t);
  }, [step, steps, inView, reduced]);

  const shown = drawn > restTile || (reduced && started);
  const current = step >= 0 && step < steps.length ? steps[step] : null;

  /* Tile lit while the packet glides — follows its x, set only on change. */
  const [passing, setPassing] = useState(restTile);
  const packet = useSpring(
    current
      ? {
          x: current.x,
          o: current.o,
          immediate: current.jump || !started,
          config: (key: string) =>
            key === "o" && current.fade
              ? { duration: current.fade }
              : current.move
                ? { duration: current.move, easing: current.easing }
                : SPRING_SOFT,
          onChange: ({ value }: { value: { x: number } }) => {
            if (current.active !== null) return;
            const lit = nearest(geometry, count, value.x);
            setPassing((prev) => (prev === lit ? prev : lit));
          },
        }
      : {
          x: geometry.rest,
          o: shown ? 1 : 0,
          immediate: !started,
          config: SPRING_SOFT,
        },
  );

  const { x: packetX, o: packetO } = packet as {
    x: SpringValue<number>;
    o: SpringValue<number>;
  };

  const active = current ? (current.active ?? passing) : restTile;

  return (
    <div ref={root} className="absolute inset-0">
      {/* One rail, as the Figma vector (Rail in each frame): it runs
          continuously and the tiles' own background blur frosts it where they
          sit on top. */}
      <RailLayers
        geometry={geometry}
        drawP={draw.p}
        packetX={packetX}
        packetO={packetO}
        count={count}
        frame={frame}
      />

      <ul
        ref={row}
        className="absolute top-40 left-20 flex gap-28.5 w1024:top-21 w1024:left-12 w1024:gap-[calc(var(--spacing)*28.4)] w768:top-23 w768:left-10 w768:gap-[calc(var(--spacing)*16.4)] w390:top-24 w390:left-5 w390:gap-10.5"
      >
        {apps.map((app, i) => {
          const lane = lanes[i];
          return (
            <AppTile
              key={app.name}
              name={app.name}
              initials={app.initials}
              align={
                lane === 0 ? "start" : lane === count - 1 ? "end" : "center"
              }
              in1024={app.in1024}
              in390={app.in390}
              shown={reduced ? started : lane >= 0 && lane < drawn}
              active={lane >= 0 && lane === active}
            />
          );
        })}
      </ul>
    </div>
  );
};
