"use client";

import Image from "@/components/compat/image";
import { useEffect, useRef } from "react";

import { pick, useFrame } from "@/hooks/use-frame";
import { VIEW_MARGIN } from "@/lib/view";

import type { ScaleContent } from "@/data/mocks/home/scale";

/**
 * Node / label positions inside the hub group, in mock order SL, ST, PG, HS.
 * Base = 1440 (3888:6466 …); 1024 draws the same group scaled (see HUB), so it
 * has no classes of its own. 768 (3862:9 …) is its own layout, placed 125 in
 * from the art edge by HUB; 390 (3918:1359 …) is its own layout again.
 */
const APP_LAYOUT = [
  {
    node: "top-37.25 left-17 w768:top-39.75 w768:left-6 w390:top-[calc(var(--spacing)*27.3125)] w390:left-2.25",
    label:
      "top-48.75 left-13 w768:top-51.25 w768:left-0 w390:top-37.25 w390:left-2.25 w390:w-9.5",
  },
  {
    node: "top-18.75 left-35.75 w768:top-18.75 w768:left-22 w390:top-10.75 w390:left-8.25",
    label:
      "top-30.25 left-31.75 w768:top-30.25 w768:left-16 w390:top-19.25 w390:left-9.75 w390:w-11.25",
  },
  {
    node: "top-18.75 left-95.75 w768:top-18.75 w768:left-65.5 w390:top-9.75 w390:left-62.75",
    label:
      "top-30.25 left-91.75 w768:top-30.25 w768:left-59.5 w390:top-19.25 w390:left-54.75 w390:w-15",
  },
  {
    node: "top-37.25 left-114.5 w768:top-39.75 w768:left-81.5 w390:top-[calc(var(--spacing)*27.3125)] w390:left-66.75",
    label:
      "top-48.75 left-110.5 w768:top-51.25 w768:left-75.5 w390:top-37.25 w390:left-62.25 w390:w-13",
  },
] as const;

/** Packets 3888:6483 … / 3862:26 … / 3918:1376 …, in mock order SL, ST, PG, HS. */
const PACKETS = [
  {
    position:
      "top-41.5 left-40 w768:top-44 w768:left-31 w390:top-30.5 w390:left-18.75",
  },
  {
    position:
      "top-31.25 left-53.5 w768:top-33 w768:left-36.5 w390:top-22.25 w390:left-26",
  },
  {
    position:
      "top-31.25 left-86.5 w768:top-32.5 w768:left-60 w390:top-22.25 w390:left-49.75",
  },
  {
    position:
      "top-41.5 left-100 w768:top-44 w768:left-65 w390:top-30.5 w390:left-57",
  },
] as const;

/**
 * Each packet rides its wire from the satellite centre (`dx`, `dy` = vector to
 * the runtime centre, design px of the active frame); `rest` is the Figma
 * position as a fraction of that trip. 1024 reuses the 1440 set — the group is
 * scaled there, and the packets with it. 768 and 390 draw the satellites
 * elsewhere, so they carry their own. At 390 the spokes do not point at the
 * tile centre, so ST / PG ride the spoke line itself. Timing is shared — only
 * the geometry changes.
 */
const WIRES = {
  1440: [
    { dx: 195, dy: 0, rest: 75 / 195 },
    { dx: 120, dy: 74, rest: 54 / 120 },
    { dx: -120, dy: 74, rest: 54 / 120 },
    { dx: -195, dy: 0, rest: 75 / 195 },
  ],
  768: [
    { dx: 151, dy: 0, rest: 83 / 151 },
    { dx: 87, dy: 84, rest: 41 / 87 },
    { dx: -87, dy: 84, rest: 39 / 87 },
    { dx: -151, dy: 0, rest: 83 / 151 },
  ],
  390: [
    { dx: 129, dy: 0, rest: 52 / 129 },
    { dx: 105, dy: 48, rest: 57 / 105 },
    { dx: -113, dy: 51.5, rest: 66 / 113 },
    { dx: -129, dy: 0, rest: 53 / 129 },
  ],
} as const;

type Wires = (typeof WIRES)[keyof typeof WIRES];

/** Design px → rem (1 rem = 16 design px in every frame). */
const REM = 16;

/**
 * The hub group: the 1440 art box (566 × 336). At 1024 (3949:13234) Figma
 * draws the same group at 0.888 from (-47.31, -6.91); at 768 it is shifted
 * 125 right; at 390 it sits at the art origin.
 */
const HUB =
  "absolute top-0 left-0 h-84 w-141.5 origin-top-left w1024:translate-x-[calc(var(--spacing)*-11.8282)] w1024:translate-y-[calc(var(--spacing)*-1.7273)] w1024:scale-[0.888031] w768:translate-x-31.25 w768:translate-y-0 w768:scale-100 w390:translate-x-0";

/** Loop timing (motion brief, scale.hub "Orbits and packets"). */
const ORBIT_MS = 32_000;
const PACKET_MS = 1_920;
const BREATH_MS = 3_840;
/** Per-wire phase offset, fraction of a packet cycle. */
const WIRE_OFFSET = [0, 0.25, 0.5, 0.75] as const;

const MONO_DIM =
  "font-mono text-scale-mono leading-scale-mono text-foreground-dim";

const smooth = (edge0: number, edge1: number, v: number) => {
  const x = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
};

export interface RuntimeHubProps {
  label: string;
  apps: ScaleContent["runtime"]["apps"];
}

/**
 * Art 3888:6457 (3949:13234 at 1024, 3862:2 at 768, 3909:12622 at 390) — the runtime hub. Once the art is properly seen
 * (VIEW_MARGIN) one rAF loop, from t = 0,
 * turns the orbit rings in opposite directions, sends lime packets down each
 * wire into the runtime tile (the sender's border flashes), and breathes the
 * core glow. Fully off screen the loop stops and rewinds to t = 0, so the
 * next visit starts from the beginning; with reduced motion it never starts,
 * so the art stays on the Figma frame.
 */
export const RuntimeHub = ({ label, apps }: RuntimeHubProps) => {
  const root = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLImageElement>(null);
  const inner = useRef<HTMLImageElement>(null);
  const outer = useRef<HTMLImageElement>(null);
  const packets = useRef<(HTMLImageElement | null)[]>([]);
  const flashes = useRef<(HTMLSpanElement | null)[]>([]);

  /* Crossing a frame line swaps the wire set; `redraw` re-renders the current
     loop time so the packets land on the other frame's wires without a restart. */
  const frame = useFrame();
  const wires = useRef<Wires>(WIRES[1440]);
  const redraw = useRef<(() => void) | null>(null);
  useEffect(() => {
    wires.current = pick<Wires>(frame, WIRES);
    redraw.current?.();
  }, [frame]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let last = 0;
    let elapsed = 0;

    const render = (t: number) => {
      const turn = ((t % ORBIT_MS) / ORBIT_MS) * 360;
      if (outer.current) outer.current.style.transform = `rotate(${turn}deg)`;
      if (inner.current) inner.current.style.transform = `rotate(${-turn}deg)`;

      const breath = (1 - Math.cos((2 * Math.PI * t) / BREATH_MS)) / 2;
      if (glow.current) {
        glow.current.style.opacity = String(1 - 0.3 * breath);
        glow.current.style.transform = `scale(${1 + 0.06 * breath})`;
      }

      wires.current.forEach((wire, i) => {
        const p = (wire.rest + t / PACKET_MS + WIRE_OFFSET[i]) % 1;
        const el = packets.current[i];
        if (el) {
          const shift = p - wire.rest;
          el.style.transform = `translate(${(shift * wire.dx) / REM}rem, ${(shift * wire.dy) / REM}rem)`;
          el.style.opacity = String(
            smooth(0, 0.15, p) * (1 - smooth(0.85, 1, p)),
          );
        }
        const ring = flashes.current[i];
        if (ring) ring.style.opacity = String(Math.max(0, 1 - p / 0.3) ** 2);
      });
    };

    const tick = (now: number) => {
      if (last) elapsed += Math.min(now - last, 100);
      last = now;
      render(elapsed);
      raf = requestAnimationFrame(tick);
    };

    let running = false;
    const rewind = () => {
      cancelAnimationFrame(raf);
      running = false;
      last = 0;
      elapsed = 0;
      render(0);
    };
    /* Park on the loop's first frame so the start is not a jump. */
    rewind();

    redraw.current = () => render(elapsed);

    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || running) return;
        running = true;
        raf = requestAnimationFrame(tick);
      },
      { rootMargin: VIEW_MARGIN },
    );
    const gone = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) rewind();
    });
    /* Start with the card (its reveal), not the art further down it. */
    seen.observe(node.closest("article") ?? node);
    gone.observe(node);

    return () => {
      redraw.current = null;
      seen.disconnect();
      gone.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={root} className={HUB}>
      {/* Wires at 768 (3862:3 … 5) and 390 (3918:1353 … 55) — flat grey rails
          under the glow, so they are drawn before it (the 1440 gradient wires,
          also used scaled at 1024, stay on top, below). Boxes = the wire span
          + 1 of stroke bleed. */}
      <Image
        src="/assets/scale/scale-wires-768.svg"
        alt=""
        width={304}
        height={86}
        className="absolute top-23.5 left-10.75 hidden h-21.5 w-76 w768:block w390:hidden"
      />
      <Image
        src="/assets/scale/scale-wires-390.svg"
        alt=""
        width={228}
        height={57}
        className="absolute top-17.5 left-10.25 hidden h-14.25 w-57 w390:block"
      />
      {/* Core glow 3888:6458 / 3862:6 / 3918:1356 — 280 / 240 / 200 circle,
          exported with its blur padding (120, scaled) on every side. */}
      <Image
        ref={glow}
        src="/assets/scale/scale-core-glow.png"
        unoptimized
        alt=""
        width={520}
        height={520}
        className="absolute -top-22 left-5.75 size-130 max-w-none w768:-top-15.25 w768:-left-11.25 w768:size-120 w390:-top-18.5 w390:size-100"
      />
      <Image
        ref={inner}
        src="/assets/scale/scale-orbit-inner.png"
        alt=""
        width={176}
        height={176}
        className="absolute top-20.25 left-48.75 size-44 w768:top-27.25 w768:left-31.25 w768:size-35 w390:top-17 w390:left-24.25 w390:size-29"
      />
      <Image
        ref={outer}
        src="/assets/scale/scale-orbit-outer.png"
        alt=""
        width={220}
        height={220}
        className="absolute top-14.75 left-43.25 size-55 w768:top-22.25 w768:left-26.25 w768:size-45 w390:top-12.75 w390:left-20 w390:size-37.5"
      />
      <Image
        src="/assets/scale/scale-wires.svg"
        alt=""
        width={518}
        height={240}
        className="absolute top-7.25 left-6 h-60 w-129.5 w768:hidden"
      />

      {/* Packets sit under the nodes and the tile, so they leave and land out of sight. */}
      {PACKETS.map((packet, i) => (
        <Image
          key={packet.position}
          ref={(el) => {
            packets.current[i] = el;
          }}
          src="/assets/scale/scale-packet.svg"
          alt=""
          width={6}
          height={6}
          className={`absolute size-1.5 ${packet.position}`}
        />
      ))}

      <ul aria-label={label}>
        {apps.map((app, i) => (
          <li key={app.code}>
            <span
              aria-hidden="true"
              className={`absolute flex size-10 items-center justify-center overflow-clip rounded-full border border-border-subtle bg-surface-badge font-mono text-scale-mono leading-scale-mono text-foreground-muted shadow-float w390:size-8.5 ${APP_LAYOUT[i].node}`}
            >
              {app.code}
            </span>
            <span
              ref={(el) => {
                flashes.current[i] = el;
              }}
              aria-hidden="true"
              className={`absolute size-10 rounded-full border border-accent opacity-0 w390:size-8.5 ${APP_LAYOUT[i].node}`}
            />
            <span
              className={`absolute w-18 text-center whitespace-nowrap w768:w-22 ${MONO_DIM} ${APP_LAYOUT[i].label}`}
            >
              {app.name}
            </span>
          </li>
        ))}
      </ul>

      {/* Runtime 3888:6474 / 3862:17 / 3918:1367 — the lead's logo transition
          flies into this tile (data-logo-target) in every frame. */}
      <Image
        src="/brand/cordon-symbol.png"
        alt=""
        data-logo-target=""
        width={96}
        height={96}
        className="absolute top-30.25 left-58.75 size-24 w768:top-33.75 w768:left-37.75 w768:size-22 w390:top-[calc(var(--spacing)*23.5625)] w390:left-30.75 w390:size-16"
      />
    </div>
  );
};
