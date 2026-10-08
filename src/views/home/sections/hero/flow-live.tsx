"use client";

import { animated, useSpring } from "@react-spring/web";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useDynamicInView } from "@/hooks/animation/use-dynamic-in-view";
import { useLoopInView } from "@/hooks/animation/use-loop-in-view";
import { pick, useFrame, type Frame } from "@/hooks/use-frame";
import { SPRING_SOFT } from "@/lib/motion";

import { LIVE, LOAD } from "./timeline";
/** First screen: start as soon as it is visible, not at the VIEW_MARGIN line. */
const HERO_MARGIN = "0px";

/* ─── shared helpers ──────────────────────────────────────────────────── */

const useMedia = (query: string) => {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return matches;
};

const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

/** `true` from the first time the attached node enters view. */
const usePlayed = () => {
  const [setNode, inView] = useDynamicInView({ rootMargin: HERO_MARGIN });
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    if (inView) setPlayed(true);
  }, [inView]);
  return [setNode, played] as const;
};

/* ─── routes (window padding-box coordinates) ─────────────────────────── */

type Pt = readonly [number, number];
type Seg = readonly [Pt, Pt, Pt, Pt]; // cubic; a line repeats its ends

const cubic = (s: Seg, t: number): Pt => {
  const m = 1 - t;
  const a = m * m * m,
    b = 3 * m * m * t,
    c = 3 * m * t * t,
    d = t * t * t;
  return [
    a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0],
    a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1],
  ];
};

interface Route {
  pts: Pt[];
  len: number[];
  /** Arc length of the whole trip. */
  total: number;
  /** Arc length at the branch node's port — where that port flashes. */
  hit: number;
}

const buildRoute = (segs: Seg[], hitSeg: number): Route => {
  const pts: Pt[] = [segs[0][0]];
  const len = [0];
  const ends: number[] = [];
  for (const s of segs) {
    for (let i = 1; i <= 48; i++) {
      const p = cubic(s, i / 48);
      const q = pts[pts.length - 1];
      pts.push(p);
      len.push(len[len.length - 1] + Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
    ends.push(len[len.length - 1]);
  }
  return { pts, len, total: ends[ends.length - 1], hit: ends[hitSeg] };
};

const pointAt = ({ pts, len }: Route, d: number): Pt => {
  let i = 1;
  while (i < len.length - 1 && len[i] < d) i++;
  const span = len[i] - len[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - len[i - 1]) / span));
  return [
    pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
    pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
  ];
};

/**
 * Refund created's port → along the drawn true / else connector (3684:95) into
 * Amount over 5000 / Log to warehouse, through the card to its right port →
 * along the drawn connector into Ask finance's port.
 */
const branch = (y: number): Seg[] => [
  [
    [89, 279],
    [129, 279],
    [129, y],
    [169, y],
  ],
  [
    [169, y],
    [169, y],
    [379, y],
    [379, y],
  ],
  [
    [379, y],
    [419, y],
    [419, 279],
    [459, 279],
  ],
];

/**
 * The vertical flow of the narrow frames — the same trip turned 90°: down the
 * stem out of Refund created, along the true / else edge into the branch
 * column `x`, straight down through the card, then along the second edge and
 * stem into Ask finance. `c1` / `c2` are the edge's control-point drops.
 */
interface VFlow {
  /** Stem x and the y of Refund created's out-port. */
  cx: number;
  y0: number;
  stem: number;
  edge: number;
  c1: number;
  c2: number;
  /** In-port to out-port through a branch card. */
  card: number;
}

const vertical = (
  { cx, y0, stem, edge, c1, c2, card }: VFlow,
  x: number,
): Seg[] => {
  const a = y0 + stem;
  const b = a + edge;
  const c = b + card;
  const d = c + edge;
  return [
    [
      [cx, y0],
      [cx, y0],
      [cx, a],
      [cx, a],
    ],
    [
      [cx, a],
      [cx, a + c1],
      [x, a + c2],
      [x, b],
    ],
    [
      [x, b],
      [x, b],
      [x, c],
      [x, c],
    ],
    [
      [x, c],
      [x, c + c1],
      [cx, c + c2],
      [cx, d],
    ],
    [
      [cx, d],
      [cx, d],
      [cx, d + stem],
      [cx, d + stem],
    ],
  ];
};

/** 1024 (3726:647 … 3726:652) and 768 (3838:2 … 3838:7), padding-box px. */
const V1024: VFlow = {
  cx: 257,
  y0: 189,
  stem: 16,
  edge: 52,
  c1: 29,
  c2: 23,
  card: 60,
};
const V768: VFlow = {
  cx: 257,
  y0: 190,
  stem: 14,
  edge: 50,
  c1: 30,
  c2: 20,
  card: 60,
};

/**
 * Every frame hits the branch node's port at the end of segment 1. 390 runs
 * the 768 flow inside a wrapper scaled 310 / 380 (3957:1556), so it reuses the
 * 768 routes; only its packet box (the unscaled wrapper) differs.
 */
const ROUTES: Record<Frame, { lime: Route; grey: Route }> = {
  1440: { lime: buildRoute(branch(199), 1), grey: buildRoute(branch(359), 1) },
  1024: {
    lime: buildRoute(vertical(V1024, 143), 1),
    grey: buildRoute(vertical(V1024, 371), 1),
  },
  768: {
    lime: buildRoute(vertical(V768, 153), 1),
    grey: buildRoute(vertical(V768, 361), 1),
  },
  390: {
    lime: buildRoute(vertical(V768, 153), 1),
    grey: buildRoute(vertical(V768, 361), 1),
  },
};

/** Packet svg user units = the window's padding box, per frame. */
const PACKET_BOX: Record<Frame, string> = {
  1440: "0 0 678 622",
  1024: "0 0 514 657",
  768: "0 0 514 588",
  390: "0 0 348 513",
};

const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
/** Trip fraction at which the eased packet reaches arc fraction `s`. */
const easeInv = (s: number) => Math.acos(1 - 2 * s) / Math.PI;

type PortId = "trigger" | "condition" | "log" | "approval";

/* ─── provider + loop ─────────────────────────────────────────────────── */

type Register = (id: string) => (el: Element | null) => void;
const FlowContext = createContext<Register>(() => () => {});

/**
 * "Live run": after the load sequence a packet runs Refund created →
 * Amount over 5000 → Ask finance every LIVE.period (every LIVE.greyEvery-th
 * trip takes the grey branch through Log to warehouse), and each port it
 * reaches flashes. Runs only while in view; reduced motion renders nothing.
 */
export const FlowLive = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, Element>());
  const cache = useRef(new Map<string, (el: Element | null) => void>());
  const t0 = useRef<number | null>(null);
  const [setInViewNode, , inViewRef] = useDynamicInView({
    rootMargin: HERO_MARGIN,
  });
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);
  const frame = useFrame();
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const register = useMemo<Register>(
    () => (id) => {
      let fn = cache.current.get(id);
      if (!fn) {
        fn = (el) => {
          if (el) els.current.set(id, el);
          else els.current.delete(id);
        };
        cache.current.set(id, fn);
      }
      return fn;
    },
    [],
  );

  useLoopInView(
    rootRef as React.RefObject<HTMLDivElement>,
    (time) => {
      if (reducedRef.current) return;
      if (t0.current === null) {
        if (!inViewRef.current) return;
        t0.current = time + LOAD.packet;
      }
      const t = time - t0.current;
      const lime = els.current.get("packet-lime") as SVGGElement | undefined;
      const grey = els.current.get("packet-grey") as SVGGElement | undefined;
      if (t < 0 || !lime || !grey) return;

      const k = Math.floor(t / LIVE.period);
      const into = t - k * LIVE.period;
      const isGrey = k % LIVE.greyEvery === LIVE.greyEvery - 1;
      const routes = ROUTES[frameRef.current];
      const route = isGrey ? routes.grey : routes.lime;
      const total = route.total;
      const u = into / LIVE.trip;

      const on = isGrey ? grey : lime;
      (isGrey ? lime : grey).style.opacity = "0";
      if (u <= 1) {
        const [x, y] = pointAt(route, ease(u) * total);
        on.setAttribute("transform", `translate(${x} ${y})`);
        on.style.opacity = String(Math.min(1, u / 0.08, (1 - u) / 0.04));
      } else {
        on.style.opacity = "0";
      }

      const hits: Record<PortId, number | null> = {
        trigger: 0,
        condition: isGrey ? null : easeInv(route.hit / total),
        log: isGrey ? easeInv(route.hit / total) : null,
        approval: 1,
      };
      for (const id of Object.keys(hits) as PortId[]) {
        const el = els.current.get(`flash-${id}`) as HTMLElement | undefined;
        if (!el) continue;
        const hit = hits[id];
        const since = hit === null ? -1 : into - hit * LIVE.trip;
        const f =
          since < 0 || since > LIVE.flash ? 0 : (1 - since / LIVE.flash) ** 2;
        el.style.opacity = String(f * 0.85);
        el.style.transform = `scale(${1 + (1 - f) * 1.4})`;
      }
    },
    { framerate: 0 },
  );

  return (
    <FlowContext.Provider value={register}>
      <div
        ref={(node) => {
          rootRef.current = node;
          setInViewNode(node);
        }}
        className={className}
      >
        {children}
      </div>
    </FlowContext.Provider>
  );
};

/** Lime halo under a port — expands and fades when a packet reaches it. */
export const PortFlash = ({
  id,
  className,
}: {
  id: PortId;
  className: string;
}) => {
  const register = useContext(FlowContext);
  return (
    <span
      ref={register(`flash-${id}`)}
      aria-hidden
      className={`absolute size-2 rounded-full bg-hero-packet opacity-0 ${className}`}
    />
  );
};

/** The travelling packets — one lime, one for the grey branch. */
export const Packets = () => {
  const register = useContext(FlowContext);
  const frame = useFrame();
  return (
    <svg
      aria-hidden
      viewBox={PACKET_BOX[frame]}
      preserveAspectRatio="none"
      className="absolute inset-0 size-full overflow-visible"
      fill="none"
    >
      <g ref={register("packet-lime")} opacity={0}>
        <circle r={6} className="fill-hero-packet-halo" />
        <circle r={2.5} className="fill-hero-packet" />
      </g>
      <g ref={register("packet-grey")} opacity={0}>
        <circle r={5} className="fill-hero-packet-grey-halo" />
        <circle r={2.25} className="fill-hero-packet-grey" />
      </g>
    </svg>
  );
};

/* ─── load-sequence strokes ───────────────────────────────────────────── */

/**
 * Connectors inline so each path can draw from its source port: the right
 * group (3684:93) into Ask finance, the mirrored left group (3684:95) out of
 * Refund created towards Amount over 5000 (true) and Log to warehouse (else).
 * The lime stroke is brightest at the shared port in both.
 */
export const Connectors = ({
  className,
  mirror = false,
}: {
  className: string;
  /** Left group 3684:95 — Refund created fanning out to true / else. */
  mirror?: boolean;
}) => {
  const [setNode, played] = usePlayed();
  const reduced = useReducedMotion();
  const gradient = mirror ? "hero-connector-lime-left" : "hero-connector-lime";
  const gradient1024 = `${gradient}-1024`;
  const { d } = useSpring({
    d: played || reduced ? 0 : 1,
    delay: reduced ? 0 : mirror ? LOAD.connectorsIn : LOAD.connectors,
    immediate: reduced,
    config: SPRING_SOFT,
  });
  const draw = {
    strokeWidth: 2,
    strokeLinecap: "round",
    pathLength: 1,
    strokeDasharray: "1 1",
  } as const;
  const fade = d.to((u) => (u > 0.995 ? 0 : 1));
  const v = pick(useFrame(), { 1440: FAN_1024, 768: FAN_768 });
  const m = v.w / 2;
  const h = v.stem + v.edge;
  /** Stem foot → branch column `x` (top group). */
  const edgeDown = (x: number) =>
    `M${m} ${v.stem}C${m} ${v.stem + v.c1} ${x} ${v.stem + v.c2} ${x} ${h}`;
  /** Branch column `x` → stem head (bottom group). */
  const edgeUp = (x: number) =>
    `M${x} 0C${x} ${v.c1} ${m} ${v.c2} ${m} ${v.edge}`;
  return (
    <div ref={setNode} aria-hidden className={className}>
      <svg
        width="80"
        height="180"
        viewBox="0 0 80 180"
        fill="none"
        className="block size-full overflow-visible w1024:hidden"
      >
        <defs>
          <linearGradient
            id={gradient}
            x1={mirror ? 80 : 0}
            y1="50"
            x2={mirror ? 0 : 80}
            y2="50"
            gradientUnits="userSpaceOnUse"
          >
            <stop className="[stop-color:var(--hero-connector)] [stop-opacity:0.25]" />
            <stop
              offset="1"
              className="[stop-color:var(--hero-connector)] [stop-opacity:0.95]"
            />
          </linearGradient>
        </defs>
        <animated.path
          d={mirror ? "M0 90C40 90 40 10 80 10" : "M0 10C40 10 40 90 80 90"}
          stroke={`url(#${gradient})`}
          {...draw}
          strokeDashoffset={d}
          opacity={fade}
        />
        <animated.path
          d={mirror ? "M0 90C40 90 40 170 80 170" : "M0 170C40 170 40 90 80 90"}
          className="stroke-hero-connector-grey"
          {...draw}
          strokeDashoffset={d}
          opacity={fade}
        />
      </svg>

      {/* 1024 (3726:647 … 3726:652) / 768 (3838:2 … 3838:7): the same fan
          turned 90° — a grey stem on the shared side, then the lime true edge
          and the grey else edge. Unlike 1440 the lime is brightest at the
          *node* end (0.95 → 0.3). */}
      <svg
        width={v.w}
        height={h}
        viewBox={`0 0 ${v.w} ${h}`}
        fill="none"
        className="hidden size-full overflow-visible w1024:block"
      >
        <defs>
          <linearGradient
            id={gradient1024}
            x1={m}
            y1={mirror ? v.stem : v.edge}
            x2={m}
            y2={mirror ? h : 0}
            gradientUnits="userSpaceOnUse"
          >
            <stop className="[stop-color:var(--hero-connector)] [stop-opacity:0.3]" />
            <stop
              offset="1"
              className="[stop-color:var(--hero-connector)] [stop-opacity:0.95]"
            />
          </linearGradient>
        </defs>
        <animated.path
          d={mirror ? `M${m} 0V${v.stem}` : `M${m} ${v.edge}V${h}`}
          className="stroke-hero-connector-grey"
          {...draw}
          strokeDashoffset={d}
          opacity={fade}
        />
        <animated.path
          d={mirror ? edgeDown(0) : edgeUp(0)}
          stroke={`url(#${gradient1024})`}
          {...draw}
          strokeDashoffset={d}
          opacity={fade}
        />
        <animated.path
          d={mirror ? edgeDown(v.w) : edgeUp(v.w)}
          className="stroke-hero-connector-grey"
          {...draw}
          strokeDashoffset={d}
          opacity={fade}
        />
      </svg>
    </div>
  );
};

/** Vertical fan box per frame: branch-column span, stem, edge and its drops. */
interface Fan {
  w: number;
  stem: number;
  edge: number;
  c1: number;
  c2: number;
}
const FAN_1024: Fan = { w: 228, stem: 16, edge: 52, c1: 29, c2: 23 };
const FAN_768: Fan = { w: 208, stem: 14, edge: 50, c1: 30, c2: 20 };

/** Port that pops in at `delay` (ms into the load). */
export const PortIn = ({
  children,
  delay,
  className,
}: {
  children: ReactNode;
  delay: number;
  className: string;
}) => {
  const [setNode, played] = usePlayed();
  const reduced = useReducedMotion();
  const s = useSpring({
    opacity: played || reduced ? 1 : 0,
    scale: played || reduced ? 1 : 0.4,
    delay: reduced ? 0 : delay,
    immediate: reduced,
    config: SPRING_SOFT,
  });
  return (
    <animated.span
      ref={setNode}
      aria-hidden
      className={`absolute block ${className}`}
      style={{
        opacity: s.opacity,
        transform: s.scale.to((v) => (v === 1 ? "none" : `scale(${v})`)),
      }}
    >
      {children}
    </animated.span>
  );
};

/** Canvas dots come up in a wave from the window centre. */
export const GridWave = ({ children }: { children: ReactNode }) => {
  const [setNode, played] = usePlayed();
  const reduced = useReducedMotion();
  const { r } = useSpring({
    r: played || reduced ? 1 : -0.25,
    delay: reduced ? 0 : LOAD.grid,
    immediate: reduced,
    config: SPRING_SOFT,
  });
  const mask = r.to((v) =>
    v === 1
      ? "none"
      : `radial-gradient(circle at 50% 50%, black ${v * 480}px, transparent ${v * 480 + 120}px)`,
  );
  return (
    <animated.div
      ref={setNode}
      aria-hidden
      className="absolute inset-0"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </animated.div>
  );
};
