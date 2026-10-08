"use client";

import { animated, useSpring, useTrail } from "@react-spring/web";
import Link from "@/components/compat/link";
import { useEffect, useId, useRef, useState } from "react";

import type { NavContent } from "@/data/mocks/home/nav";
import { useFrame } from "@/hooks/use-frame";
import { SPRING } from "@/lib/motion";

/**
 * Menu button of the 390 frame (Menu 3900:3 — 40 round glass button with
 * three bars, the last one shorter) and the menu it opens. The frame hides
 * the link row at 390, so the menu carries those same links: the nav bar
 * grows into a card (design variant 4 — not in Figma).
 *
 * Only rendered visible at 390 (`hidden w390:flex`); it closes itself when
 * the layout leaves that frame, on Escape, on a click outside and on a link
 * click. Bars fold into a cross, the card scales out of the button's corner
 * and the rows trail in, all on the page spring.
 */
export const NavMenu = ({ links }: Pick<NavContent, "links">) => {
  const [open, setOpen] = useState(false);
  const frame = useFrame();
  const panelId = useId();

  if (open && frame !== 390) setOpen(false);

  const card = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (card.current?.contains(target) || button.current?.contains(target))
        return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const s = useSpring({ t: open ? 1 : 0, config: SPRING });
  // Rows follow the card in on a short trail; they leave together.
  const rows = useTrail(links.length, {
    t: open ? 1 : 0,
    delay: open ? 60 : 0,
    config: SPRING,
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="relative hidden size-10 shrink-0 cursor-pointer rounded-full border border-border-subtle bg-surface-glass w390:block"
      >
        <animated.span
          aria-hidden="true"
          className="absolute top-3.25 left-2.75 h-0.5 w-4 rounded-full bg-foreground/90"
          style={{
            transform: s.t.to(
              (t) => `translateY(${t * 0.375}rem) rotate(${t * 45}deg)`,
            ),
          }}
        />
        <animated.span
          aria-hidden="true"
          className="absolute top-4.75 left-2.75 h-0.5 w-4 rounded-full bg-foreground/90"
          style={{ opacity: s.t.to((t) => 1 - t) }}
        />
        <animated.span
          aria-hidden="true"
          className="absolute top-6 left-3.5 h-0.5 w-2.5 rounded-full bg-foreground/90"
          style={{
            transform: s.t.to(
              (t) =>
                `translateY(${-t * 0.3125}rem) rotate(${-t * 45}deg) scaleX(${1 + t * 0.6})`,
            ),
          }}
        />
      </button>

      {/* The bar grows into a card behind the brand and button (-z-10 in the
          header's stacking context): one row per link — mono tile like the
          integration tiles, label, one-line note. */}
      <animated.nav
        ref={card}
        id={panelId}
        aria-label="Primary"
        className="absolute inset-x-2 top-2 -z-10 hidden origin-top-right rounded-nav-menu border border-border-subtle bg-surface-raised px-2 pt-12 pb-2 w390:block"
        style={{
          opacity: s.t,
          transform: s.t.to((t) => `scale(${0.94 + t * 0.06})`),
          visibility: s.t.to((t) => (t < 0.01 ? "hidden" : "visible")),
        }}
      >
        <ul className="flex flex-col gap-0.5">
          {links.map((link, i) => (
            <animated.li
              key={link.label}
              style={{
                opacity: rows[i].t,
                transform: rows[i].t.to(
                  (t) => `translateY(${(1 - t) * 0.5}rem)`,
                ),
              }}
            >
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                className="group flex items-center gap-3 rounded-nav-menu-row p-2.5 transition-colors duration-(--motion-fast) ease-entrance hover:bg-surface-glass focus-visible:bg-surface-glass"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-nav-menu-tile border border-border-subtle font-mono text-label leading-label text-foreground-muted transition-colors duration-(--motion-fast) ease-entrance group-hover:border-accent/50 group-hover:bg-accent/10 group-hover:text-accent group-focus-visible:border-accent/50 group-focus-visible:bg-accent/10 group-focus-visible:text-accent">
                  {link.code}
                </span>
                <span className="flex flex-col">
                  <span className="text-body leading-body font-medium text-foreground">
                    {link.label}
                  </span>
                  <span className="text-label leading-label text-foreground-muted">
                    {link.note}
                  </span>
                </span>
              </Link>
            </animated.li>
          ))}
        </ul>
      </animated.nav>
    </>
  );
};
