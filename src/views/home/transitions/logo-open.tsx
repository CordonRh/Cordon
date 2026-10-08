"use client";

import Image from "@/components/compat/image";
import { useEffect, useRef, type ReactNode } from "react";

import { fold } from "./fold";

/** Scroll the plate stays pinned for, design px (15rem in the wrapper's
 *  height class below) — a short reading hold; 420 read as a stall. */
const PIN = 240;
/** Circle opening / closing length, design px of scroll. */
const OPEN = 300;
const CLOSE = 320;
/** The close starts this much before the pin releases, design px. */
const CLOSE_LEAD = 0;
/** Logo pop length, design px of scroll. */
const POP = 60;
/** The logo's flight into 06 Scale's runtime tile, design px of scroll. It
 *  starts only once the plate has folded away completely, so one logo is on
 *  screen at a time. */
const FLIGHT = 300;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
/* the fold's two stages run linearly — the overall ease is on `grow`, and a
   per-stage ease stalled the motion at the square */
const linear = (t: number) => t;

/** The Mark's chevron glyph, placed as on the plate (34 × 37 at 21.5 / 18.5 of 76). */
const Glyph = () => (
  <Image
    src="/brand/cordon-symbol.png"
    alt=""
    width={34}
    height={37}
    className="absolute top-[24.3%] left-[28.25%] h-[48.76%] w-[44.1%] max-w-none"
  />
);

/**
 * Iris through 05 Statement, "logo to logo" (motion brief t3/t4), scrubbed
 * by scroll so it plays while you are on the block — and never over an empty
 * screen:
 *
 * 1. As the plate scrolls up under 04 Product, the lime Relay logo pops up
 *    where the plate's Mark sits (3488:22130) and a tile opens out over the plate.
 * 2. The plate is fully open as it reaches the middle of the screen, pins
 *    there for a short hold while its own timeline plays (`data-open`, read
 *    by StatementPlate).
 * 3. Released, the plate scrolls on while 06 Scale rises underneath; the
 *    logo holds its place on screen and the plate folds back into the logo tile.
 * 4. Once the plate has folded away, the logo flies into the runtime tile of
 *    Scale (`[data-logo-target]`), growing into it, and hands over to it.
 *
 * Numbers go to `.logo-open` in globals.css as --pop / --grow / --flying.
 */
export const LogoOpen = ({ children }: { children: ReactNode }) => {
  const wrap = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const flyRuntime = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const w = wrap.current;
    const p = plate.current;
    const m = mark.current;
    const f = fly.current;
    const fr = flyRuntime.current;
    if (!w || !p || !m || !f || !fr) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target: HTMLElement | null = null;
    const set = (name: string, v: number) =>
      p.style.setProperty(name, v.toFixed(4));

    /* Per-resize measurements (each was a forced style recalc when read every
       scrolled frame): design px → CSS px for the active frame (1 rem = 16
       design px), the plate's corner, and its own Mark's box, which anchors
       the logo and the fold. */
    let k = 1;
    let plateRound = 0;
    let markSize = 0;
    let mx = 0;
    let my = 0;
    const measure = () => {
      k = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
      plateRound =
        parseFloat(
          getComputedStyle(p.firstElementChild ?? p).borderTopLeftRadius,
        ) || 0;
      const own = p.querySelector<HTMLElement>("[data-statement-mark]");
      markSize = own?.offsetWidth ?? 76 * k;
      mx = own ? own.offsetLeft + markSize / 2 : p.offsetWidth / 2;
      my = own ? own.offsetTop + own.offsetHeight / 2 : p.offsetHeight / 2;
      p.style.setProperty("--mx", `${mx}px`);
      p.style.setProperty("--my", `${my}px`);
      p.style.setProperty("--msize", `${markSize}px`);
    };

    /* Runs in the scroll event itself: layout is clean there (the scroll
       happened off the main thread), so its reads cost nothing, and its
       writes land before the frame renders. Through a rAF it ran after the
       springs had written their styles, and every read forced a layout. */
    const update = () => {
      if (media.matches) {
        w.dataset.reduced = "true";
        w.dataset.open = "true";
        set("--grow", 1);
        p.style.clipPath = "none";
        f.hidden = true;
        return;
      }
      delete w.dataset.reduced;
      /* every layout read first, every style write after — a read between
         writes forces a layout in the middle of the frame */
      const vh = window.innerHeight;
      const plateH = p.offsetHeight;
      const plateW = p.offsetWidth;
      const wrapTop = w.getBoundingClientRect().top;
      target ??= document.querySelector<HTMLElement>("[data-logo-target]");
      const to = target?.getBoundingClientRect();
      const from = m.getBoundingClientRect();

      const pinTop = (vh - plateH) / 2;
      /* s: scroll since the plate pinned (negative while it scrolls in) */
      const s = pinTop - wrapTop;
      /* the logo starts as soon as the mark comes up over the bottom edge */
      const seenAt = pinTop + my - vh;
      const openEnd = seenAt + POP * k + OPEN * k;
      const closeStart = (PIN - CLOSE_LEAD) * k;
      const closeEnd = closeStart + CLOSE * k;

      const pop = smooth(clamp((s - seenAt) / (POP * k)));
      const opening = clamp((s - seenAt - POP * k) / (OPEN * k));
      const closing = clamp((closeEnd - s) / (CLOSE * k));
      set("--pop", pop);
      /* once released, the logo (and the fold round it) stay where they
         were pinned while the plate and 06 Scale slide up underneath */
      /* the fold follows the plate's own logo as the plate scrolls on, so it
         always ends as the logo tile itself */
      p.style.setProperty("--shift", "0px");
      const grow = smooth(Math.min(opening, closing));
      set("--grow", grow);
      p.style.clipPath = fold(
        grow,
        plateW,
        plateH,
        mx,
        my,
        markSize,
        plateRound,
        linear,
      );

      if (s >= openEnd && w.dataset.open !== "true") w.dataset.open = "true";
      if (s < seenAt && w.dataset.open === "true") w.dataset.open = "false";

      /* Flight: from the logo where the plate folded (it keeps scrolling up)
         to the live runtime tile, over a fixed stretch of scroll that starts
         the moment the fold is complete — never while the plate still shows
         its own logo (that drew two logos at once). */
      if (!target || !to) return;
      const t = clamp((s - closeEnd) / (FLIGHT * k));
      const flying = t > 0 && t < 1;
      if (s > closeEnd && w.dataset.open === "true") w.dataset.open = "false";

      set("--flying", t > 0 ? 1 : 0);
      target.style.opacity = flying ? "0" : "";
      f.hidden = !flying;
      if (!flying) return;
      const e = smooth(t);
      const size = from.width + (to.width - from.width) * e;
      const x = from.left + (to.left - from.left) * e;
      const y = from.top + (to.top - from.top) * e;
      f.style.transform = `translate(${x}px, ${y}px)`;
      f.style.width = f.style.height = `${size}px`;
      fr.style.opacity = String(clamp((e - 0.35) / 0.5));
    };

    const onResize = () => {
      measure();
      update();
    };
    measure();
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", onResize);
    media.addEventListener("change", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", onResize);
      media.removeEventListener("change", update);
      if (target) target.style.opacity = "";
    };
  }, []);

  return (
    <div
      ref={wrap}
      data-open="false"
      /* the plate (552 at 1440, 528 at 1024 and 768, 371 at 390) plus the
         pinned hold (PIN) — spelled out so Tailwind can see the classes */
      className="logo-open-wrap relative h-[calc(34.5rem+15rem)] w1024:h-[calc(33rem+15rem)] w390:h-[calc(23.1875rem+15rem)]"
    >
      <div ref={plate} className="logo-open sticky top-[calc(50lvh-16.875rem)]">
        {children}
        <span ref={mark} aria-hidden="true" className="logo-open-mark">
          <Glyph />
        </span>
      </div>
      <div
        ref={fly}
        hidden
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-30"
      >
        <span className="logo-open-fly">
          <Glyph />
        </span>
        <span
          ref={flyRuntime}
          className="absolute inset-0 bg-[url(/brand/cordon-symbol.png)] bg-cover"
        />
      </div>
    </div>
  );
};
