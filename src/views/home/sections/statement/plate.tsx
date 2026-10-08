"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { TypeText } from "@/components/ui/type-text";

import {
  StatementMotionContext,
  TYPE_CLIP,
  useStatementSeen,
} from "./use-statement-seen";

/**
 * Without the iris around it, the entrance waits until the plate's top has
 * risen to 28% of the viewport.
 */
const SEEN_MARGIN = "0px 0px -72% 0px";

/**
 * The `<section>` of 05 Statement. It owns the one trigger every leaf reads:
 * `inView` follows plain visibility; `seen` follows the iris's `data-open`
 * (true once the circle has opened, false once the plate is gone), or the
 * SEEN_MARGIN line when there is no iris — so every visit replays the timeline.
 */
export const StatementPlate = ({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const view = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
    });
    view.observe(node);

    /* Inside the logo iris (views/home/transitions/logo-open) the plate is
       pinned, so the transition says when it has opened: `data-open`. */
    const host = node.closest<HTMLElement>("[data-open]");
    if (host) {
      const sync = () => {
        setReduced(media.matches);
        setSeen(host.dataset.open === "true");
      };
      sync();
      const attrs = new MutationObserver(sync);
      attrs.observe(host, { attributes: true, attributeFilter: ["data-open"] });
      return () => {
        view.disconnect();
        attrs.disconnect();
      };
    }

    const gone = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setSeen(false);
    });
    const start = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setReduced(media.matches);
        setSeen(true);
      },
      { rootMargin: SEEN_MARGIN },
    );
    gone.observe(node);
    start.observe(node);
    return () => {
      view.disconnect();
      gone.disconnect();
      start.disconnect();
    };
  }, []);

  return (
    <StatementMotionContext.Provider value={{ seen, inView, reduced }}>
      <section
        ref={ref}
        id="statement"
        aria-labelledby="statement-title"
        className={className}
      >
        {children}
      </section>
    </StatementMotionContext.Provider>
  );
};

/** Mono label that types in on the plate's timeline, not on its own observer. */
export const StatementType = ({
  children,
  delay,
}: {
  children: string;
  delay: number;
}) => {
  const { seen } = useStatementSeen();
  if (!seen) return <span className="invisible">{children}</span>;
  return (
    <TypeText delay={delay} className={TYPE_CLIP}>
      {children}
    </TypeText>
  );
};
