"use client";

import { useEffect, useRef } from "react";

/** The grid is the same in every frame (3888:5971, 3888:10368, 3832:7635,
 * 3893:3268): 48px pitch from (25.5, 25.5), clipped by the plate — only the
 * 1440 × 548 plate shows all 30 × 11 dots. */
const W = 1440;
const H = 548;
const GRID = 48;
const OFFSET = 25.5;
const R = 1.5;
const COLS = Math.ceil((W - OFFSET) / GRID);
const ROWS = Math.ceil((H - OFFSET) / GRID);
/** Screen px per design px: 1 rem is 16 design px in every frame. */
const unit = () =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
/** Cursor influence radius (design px) and peak scale at the cursor. */
const RADIUS = 120;
const PEAK = 2.4;
/** Under-damped per-dot spring so the swell decays with a little bounce. */
const STIFFNESS = 170;
const DAMPING = 11;
const EPS = 0.002;

/**
 * Dot field — 3px dots on a 48px grid, composed as one SVG pattern.
 * On desktop, dots near the cursor scale up (colour and opacity unchanged)
 * on a canvas drawn over the plate; once every dot springs back to rest the
 * canvas is cleared and the SVG pattern shows again, so the idle plate is the
 * original pattern. Runs only while the plate is in view.
 */
export const DotField = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    const section = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !svg || !section || !ctx) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const count = COLS * ROWS;
    const scale = new Float32Array(count).fill(1);
    const velocity = new Float32Array(count);
    let pointer: { x: number; y: number } | null = null;
    let inView = false;
    let raf = 0;
    let last = 0;
    let drawing = false;

    const rest = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      svg.style.visibility = "";
      drawing = false;
    };

    const frame = (time: number) => {
      const dt = Math.min(0.032, last ? (time - last) / 1000 : 0.016);
      last = time;
      let moving = false;
      let displaced = false;
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          const n = j * COLS + i;
          let target = 1;
          if (pointer) {
            const d = Math.hypot(
              OFFSET + i * GRID - pointer.x,
              OFFSET + j * GRID - pointer.y,
            );
            if (d < RADIUS) {
              const f = 1 - (d / RADIUS) ** 2;
              target = 1 + (PEAK - 1) * f * f;
            }
          }
          velocity[n] +=
            (STIFFNESS * (target - scale[n]) - DAMPING * velocity[n]) * dt;
          scale[n] += velocity[n] * dt;
          if (Math.abs(velocity[n]) > EPS || Math.abs(target - scale[n]) > EPS)
            moving = true;
          if (Math.abs(scale[n] - 1) > EPS) displaced = true;
        }
      }

      if (!displaced && !moving) {
        rest();
        raf = 0;
        return;
      }

      const rect = section.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const k = unit() * dpr;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = getComputedStyle(canvas).color;
      ctx.beginPath();
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          const cx = OFFSET + i * GRID;
          const cy = OFFSET + j * GRID;
          const r = R * scale[j * COLS + i];
          ctx.moveTo(cx + r, cy);
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      if (!drawing) {
        svg.style.visibility = "hidden";
        drawing = true;
      }

      raf = moving && inView ? requestAnimationFrame(frame) : 0;
    };

    const kick = () => {
      if (raf || !inView) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const onMove = (event: PointerEvent) => {
      if (!fine.matches || reduce.matches || event.pointerType !== "mouse")
        return;
      const rect = section.getBoundingClientRect();
      const u = unit();
      pointer = {
        x: (event.clientX - rect.left) / u,
        y: (event.clientY - rect.top) / u,
      };
      kick();
    };
    const onLeave = () => {
      pointer = null;
      kick();
    };

    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (!inView) {
        pointer = null;
        cancelAnimationFrame(raf);
        raf = 0;
        scale.fill(1);
        velocity.fill(0);
        rest();
      }
    });
    observer.observe(section);
    section.addEventListener("pointermove", onMove);
    section.addEventListener("pointerleave", onLeave);

    return () => {
      observer.disconnect();
      section.removeEventListener("pointermove", onMove);
      section.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
      svg.style.visibility = "";
    };
  }, []);

  return (
    <>
      <svg
        ref={svgRef}
        aria-hidden="true"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="absolute top-0 left-0 h-137 w-360 max-w-none text-statement-dot"
      >
        <defs>
          <pattern
            id="statement-dots"
            width="48"
            height="48"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="25.5" cy="25.5" r="1.5" fill="currentColor" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#statement-dots)" />
      </svg>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full text-statement-dot"
      />
    </>
  );
};
