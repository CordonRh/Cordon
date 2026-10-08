"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type AriaAttributes,
  type ReactNode,
  type RefObject,
} from "react";

import { Inview } from "@/components/animation/springs/in-view";
import { useSeen } from "@/hooks/use-seen";
import { FADE, REVEAL, SPRING, SPRING_SOFT } from "@/lib/motion";
import type { Tags } from "@/types/springs";

/**
 * One timeline for the whole footer, so its entrance reads as a calm sequence
 * instead of every block firing on its own observer at once.
 *
 * - `top` (panels + status row) starts when the panel row is properly seen.
 * - `bottom` (links + legal) starts once its own row is on screen, but never
 *   before the top has had BOTTOM_AFTER ms to play.
 * - `loop` (the panel glyph) unlocks only after the entrance has settled.
 */
export const CUE = {
  panels: 0,
  brandPanel: 50,
  title: 160,
  copy: 260,
  form: 350,
  tagline: 430,
  brandLine: 490,
  social: 540,
  status: 620,
  statusStep: 130,
  bottomLine: 0,
  company: 40,
  column: 100,
  columnStep: 50,
  footLine: 300,
  legal: 380,
} as const;

/** Earliest the bottom stage may start, ms after the top one (was 1900 —
    the links waited on screen). */
const BOTTOM_AFTER = 350;
/** When the ambient loop may begin, ms after the top stage. */
const LOOP_AFTER = 1200;
/** The links row counts as on screen as it enters (5% below the fold). */
const BOTTOM_MARGIN = "0px 0px 5% 0px";

type Stage = "top" | "bottom";

interface StageState {
  refs: Record<Stage, RefObject<HTMLDivElement | null>>;
  ready: Record<Stage, boolean>;
  loop: boolean;
}

const StageContext = createContext<StageState | null>(null);

const useStage = () => {
  const ctx = useContext(StageContext);
  if (!ctx) throw new Error("Footer cues must sit inside <FooterStage>");
  return ctx;
};

/** `true` once the ambient loops may run. */
export const useLoopReady = () => useStage().loop;
/** `true` once the given stage has started. */
export const useStageReady = (stage: Stage) => useStage().ready[stage];

const useLatch = (on: boolean, after: number) => {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!on || done) return;
    const id = setTimeout(() => setDone(true), after);
    return () => clearTimeout(id);
  }, [on, done, after]);
  return done;
};

export const FooterStage = ({ children }: { children: ReactNode }) => {
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const topReady = useSeen(top);
  const bottomAllowed = useLatch(topReady, BOTTOM_AFTER);
  const loop = useLatch(topReady, LOOP_AFTER);
  const [bottomSeen, setBottomSeen] = useState(false);

  useEffect(() => {
    const el = bottom.current;
    if (!el || bottomSeen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setBottomSeen(true);
      },
      { rootMargin: BOTTOM_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [bottomSeen]);

  const value: StageState = {
    refs: { top, bottom },
    ready: { top: topReady, bottom: bottomAllowed && bottomSeen },
    loop,
  };

  return (
    <StageContext.Provider value={value}>
      <div
        ref={top}
        aria-hidden
        className="pointer-events-none absolute top-24 left-20 h-80 w-320 w1024:top-0 w1024:left-12 w1024:h-69.5 w1024:w-232 w768:top-10 w768:left-10 w768:h-142 w768:w-172 w390:top-0 w390:left-5 w390:h-165.25 w390:w-87.5"
      />
      <div
        ref={bottom}
        aria-hidden
        className="pointer-events-none absolute top-133.25 left-20 h-40.5 w-320 w1024:top-98.75 w1024:left-12 w1024:h-37.5 w1024:w-232 w768:top-177.25 w768:left-10 w768:h-70.5 w768:w-172 w390:top-198.5 w390:left-5 w390:h-81.5 w390:w-87.5"
      />
      {children}
    </StageContext.Provider>
  );
};

interface CueProps extends AriaAttributes {
  stage: Stage;
  delay?: number;
  tag?: Tags;
  className?: string;
  id?: string;
  children?: ReactNode;
}

const useCue = (stage: Stage) => {
  const { refs, ready } = useStage();
  return {
    trigger: refs[stage] as RefObject<HTMLElement>,
    enabled: ready[stage],
  };
};

/** 24px rise + fade on the footer timeline. */
export const CueRise = ({
  stage,
  delay = 0,
  tag = "div",
  ...props
}: CueProps) => (
  <Inview
    {...useCue(stage)}
    tag={tag}
    mode="once"
    from={REVEAL.from}
    to={REVEAL.to}
    config={SPRING}
    delayIn={delay}
    {...props}
  />
);

/** Plain soft fade on the footer timeline. */
export const CueFade = ({
  stage,
  delay = 0,
  tag = "div",
  ...props
}: CueProps) => (
  <Inview
    {...useCue(stage)}
    tag={tag}
    mode="once"
    from={FADE.from}
    to={FADE.to}
    config={SPRING_SOFT}
    delayIn={delay}
    {...props}
  />
);

const MASK =
  "linear-gradient(90deg, black calc(var(--reveal) - 40%), transparent var(--reveal))";

/** FocusText on the footer timeline: out of blur with a left → right sweep. */
export const CueFocus = ({
  stage,
  delay = 0,
  tag = "p",
  ...props
}: CueProps) => (
  <Inview
    {...useCue(stage)}
    tag={tag}
    mode="once"
    from={{ opacity: 0, filter: "blur(8px)", "--reveal": "0%" }}
    to={{ opacity: 1, filter: "blur(0px)", "--reveal": "140%" }}
    config={SPRING_SOFT}
    delayIn={delay}
    style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    {...props}
  />
);

/** DrawLine on the footer timeline. */
export const CueLine = ({
  stage,
  delay = 0,
  className = "",
}: {
  stage: Stage;
  delay?: number;
  className?: string;
}) => (
  <Inview
    {...useCue(stage)}
    tag="span"
    mode="once"
    aria-hidden="true"
    className={`block origin-left ${className}`}
    from={{ scaleX: 0 }}
    to={{ scaleX: 1 }}
    config={SPRING_SOFT}
    delayIn={delay}
  />
);

const cut = "round(down, calc(var(--typed) * 1ch), 1ch)";

/** TypeText on the footer timeline (mono label typing in). */
export const CueType = ({
  stage,
  delay = 0,
  per = 30,
  children,
}: {
  stage: Stage;
  delay?: number;
  per?: number;
  children: string;
}) => {
  const cue = useCue(stage);
  return (
    <Inview
      {...cue}
      tag="span"
      mode="once"
      className="relative inline-block"
      from={{ "--typed": 0 }}
      to={{ "--typed": children.length + 0.5 }}
      config={{ duration: children.length * per }}
      delayIn={delay}
      style={{ clipPath: `inset(0 calc(100% - ${cut} - 0.1ch) 0 0)` }}
    >
      {children}
    </Inview>
  );
};

/**
 * The CTA title rising out of its mask (the h2 clips) — 108% of its own
 * height (56px on the one-line 1440 title), so the two-line 390 title hides too.
 */
export const CueLineRise = ({
  stage,
  delay = 0,
  children,
}: {
  stage: Stage;
  delay?: number;
  children: ReactNode;
}) => (
  <Inview
    {...useCue(stage)}
    tag="span"
    mode="once"
    className="block"
    from={{ y: "108%" }}
    to={{ y: "0%" }}
    config={SPRING}
    delayIn={delay}
  >
    {children}
  </Inview>
);
