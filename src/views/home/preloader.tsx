"use client";

import { animated, easings, useSpring } from "@react-spring/web";
import Image from "@/components/compat/image";
import { useEffect, useState } from "react";

import { TILE_ROUND } from "./transitions/fold";

/** Give up waiting on the network after this long and open the page anyway. */
const MAX_WAIT = 6000;
/** The logo tile, design px (the Statement mark). */
const TILE = 76;
/** The ring runs this far in from the screen edge, with this corner, design px. */
const RING_INSET = 8;
const RING_ROUND = 24;
/**
 * Slow, overshoot-free springs. Progress retargets the ring's spring without
 * resetting its velocity, so the line never stops and restarts.
 */
const DRAW = { tension: 60, friction: 22 } as const;
const FLOOD = { tension: 140, friction: 26 } as const;
/**
 * The close is ONE timed motion with one ease, screen → square → tile →
 * nothing. It used to be a spring fold handing over to a separate shrink;
 * the spring's slow tail and the second motion's slow start read as a
 * pause and a jolt at the hand-over.
 */
const CLOSE = { duration: 1000, easing: easings.easeInOutQuad } as const;
/** The ring counts as closed here (the last sliver is the spring's tail). */
const CLOSED = 0.96;
/** The flood counts as full here — the spring's last 3% is invisible. */
const FULL = 0.97;

type Phase = "draw" | "flood" | "fold" | "done";
type Box = { w: number; h: number; k: number };

/**
 * Preloader (design variant 4, not in Figma). A black screen with the
 * lime Relay tile in the middle; a lime line runs round the edge of
 * the screen and how far it has gone is the loading progress (the share of
 * first-screen images and fonts done, then `load`). When the ring closes the
 * lime floods in from it until the screen is all lime, then folds back along
 * the Statement fold (screen → square → tile) into the logo, uncovering the
 * hero, and the mask keeps folding past the tile, cutting it down to nothing
 * where it is (client call — it used to fly into the nav logo, which now
 * simply stays visible).
 *
 * The head script in the root layout sets `html[data-preload]` before first
 * paint (home only, never under reduced motion); it shows this overlay from
 * the server HTML, locks scrolling and keeps `<main>` off-screen until the
 * fold, so the main screen is first seen — and plays its entrance — as the
 * lime folds away. Without JS it is never set.
 */
export const Preloader = () => {
  const [phase, setPhase] = useState<Phase>("draw");
  const [progress, setProgress] = useState(0.04);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!("preload" in document.documentElement.dataset)) {
      setPhase("done");
      return;
    }
    const measure = () => {
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      setBox({ w: window.innerWidth, h: window.innerHeight, k: rem / 16 });
    };
    measure();
    window.addEventListener("resize", measure);

    // Progress = share of the first-screen assets done: every eager image
    // plus the fonts, then the window `load` event.
    const images = [...document.images].filter((img) => img.loading !== "lazy");
    const total = images.length + 1;
    let done = images.filter((img) => img.complete).length;
    let fonts = false;
    let alive = true;
    const push = () =>
      alive &&
      setProgress((v) => Math.max(v, 0.04 + 0.76 * ((done + +fonts) / total)));
    const onImage = () => {
      done += 1;
      push();
    };
    const pending = images.filter((img) => !img.complete);
    pending.forEach((img) => {
      img.addEventListener("load", onImage, { once: true });
      img.addEventListener("error", onImage, { once: true });
    });
    document.fonts.ready.then(() => {
      fonts = true;
      push();
    });
    push();
    const onLoad = () => alive && setProgress(1);
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    const timer = window.setTimeout(onLoad, MAX_WAIT);
    return () => {
      alive = false;
      pending.forEach((img) => {
        img.removeEventListener("load", onImage);
        img.removeEventListener("error", onImage);
      });
      window.removeEventListener("resize", measure);
      window.removeEventListener("load", onLoad);
      window.clearTimeout(timer);
    };
  }, []);

  const { d } = useSpring({
    from: { d: 0 },
    to: { d: box ? progress : 0 },
    config: DRAW,
    onChange: ({ value }) => {
      if (phase === "draw" && value.d >= CLOSED) setPhase("flood");
    },
  });

  const { k } = useSpring({
    k: phase === "draw" ? 0 : 1,
    config: FLOOD,
    onChange: ({ value }) => {
      if (phase === "flood" && value.k >= FULL) setPhase("fold");
    },
  });

  const { c } = useSpring({
    c: phase === "fold" ? 1 : 0,
    config: CLOSE,
    onRest: ({ value }) => {
      if (phase === "fold" && value.c >= 1) setPhase("done");
    },
  });

  // Scrolling comes back as the plate starts folding; `data-preload-closing`
  // marks the close itself, so heavy work (the particle stream) waits it out.
  useEffect(() => {
    const root = document.documentElement;
    if (phase === "fold") root.dataset.preloadClosing = "";
    if (phase === "fold" || phase === "done") delete root.dataset.preload;
    if (phase === "done") delete root.dataset.preloadClosing;
  }, [phase]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.preloadClosing;
    },
    [],
  );

  if (phase === "done") return null;

  const folding = phase === "fold";
  const tile = box ? TILE * box.k : 0;
  const inset = box ? RING_INSET * box.k : 0;
  const reach = box ? Math.ceil(Math.max(box.w, box.h) / 2) + 2 : 0;
  // The mask's larger half-extent shrinks at one eased speed from half the
  // screen to zero: while it is wider than the screen is tall only its width
  // closes (screen → square), then it is a square closing through the tile
  // to nothing. Its corner grows into the tile's as it squares up. Once it is
  // smaller than the tile, the tile is cut down with it.
  const half = (v: number) => (box ? (1 - v) * (Math.max(box.w, box.h) / 2) : 0);
  const mask = (v: number) => {
    if (!box) return "none";
    const H = half(v);
    const hw = Math.min(H, box.w / 2);
    const hh = Math.min(H, box.h / 2);
    const side = Math.min(hw, hh) * 2;
    const squared = Math.max(box.w, box.h) === Math.min(box.w, box.h)
      ? 1
      : Math.min(
          1,
          Math.max(0, (Math.max(box.w, box.h) / 2 - H) /
            ((Math.max(box.w, box.h) - Math.min(box.w, box.h)) / 2)),
        );
    const round = side * TILE_ROUND * squared;
    return `inset(${box.h / 2 - hh}px ${box.w / 2 - hw}px round ${round}px)`;
  };
  const cut = (v: number) => {
    const side = half(v) * 2;
    if (side >= tile) return "none";
    const e = (tile - side) / 2;
    return `inset(${e}px round ${side * TILE_ROUND}px)`;
  };

  return (
    <div
      data-preloader
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-60 hidden"
      // the page attribute that shows it is gone once released
      style={folding ? { display: "block" } : undefined}
    >
      {/* black stage — the main screen waits off-screen behind it */}
      {!folding && <div className="absolute inset-0 bg-background" />}

      {box && !folding && (
        <>
          {/* progress: the ring round the screen */}
          <svg
            className="absolute inset-0 size-full"
            viewBox={`0 0 ${box.w} ${box.h}`}
            fill="none"
          >
            <animated.rect
              x={inset}
              y={inset}
              width={box.w - 2 * inset}
              height={box.h - 2 * inset}
              rx={RING_ROUND * box.k}
              pathLength={100}
              strokeDasharray="100 100"
              strokeDashoffset={d.to((v) => 100 * (1 - v))}
              className="stroke-accent"
              strokeWidth={2 * box.k}
              strokeLinecap="round"
            />
          </svg>
          {/* the flood: the ring thickening inward until the screen is lime */}
          <animated.div
            className="absolute inset-0"
            style={{
              opacity: k.to((v) => (v > 0 ? 1 : 0)),
              boxShadow: k.to(
                (v) =>
                  `inset 0 0 0 ${inset + v * (reach - inset)}px var(--color-statement-plate)`,
              ),
            }}
          />
        </>
      )}

      {folding && (
        <animated.div
          className="absolute inset-0 bg-statement-plate"
          style={{ clipPath: c.to(mask) }}
        />
      )}

      {/* The logo tile: in the middle throughout. On the lime it turns into
          the dark Statement mark (lime chevrons) so it keeps its contrast,
          and the closing lime mask cuts it down to nothing. */}
      <animated.div
        className="absolute top-[calc(50%-2.375rem)] left-[calc(50%-2.375rem)] size-preloader-mark"
        style={{ clipPath: c.to(cut) }}
      >
        <Image
          src="/brand/cordon-symbol.png"
          alt=""
          width={28}
          height={28}
          className="absolute inset-0 size-full max-w-none"
          priority
        />
        <animated.span
          className="logo-open-fly absolute inset-0"
          style={{
            // stays the dark mark to the end (no switch back to lime)
            opacity: folding ? 1 : k,
          }}
        >
          <Image
            src="/brand/cordon-symbol.png"
            alt=""
            width={34}
            height={37}
            className="absolute top-[24.3%] left-[28.25%] h-[48.76%] w-[44.1%] max-w-none"
            priority
          />
        </animated.span>
      </animated.div>
    </div>
  );
};
