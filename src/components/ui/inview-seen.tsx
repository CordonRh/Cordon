"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ComponentProps,
} from "react";

import { Inview } from "@/components/animation/springs/in-view";
import { useSeen } from "@/hooks/use-seen";

type InviewProps = ComponentProps<typeof Inview>;

/**
 * The engine's `Inview`, held back until the element is properly on screen
 * (`useSeen`). Same props; `trigger`, when given, is what has to be seen.
 * Lets the engine stay untouched while every reveal starts where the reader is.
 */
export const InviewSeen = forwardRef<HTMLElement, InviewProps>(
  ({ enabled = true, trigger, ...props }, ref) => {
    const local = useRef<HTMLElement>(null);
    useImperativeHandle(ref, () => local.current as HTMLElement);
    const seen = useSeen(trigger ?? local);
    return (
      <Inview
        {...props}
        trigger={trigger}
        ref={local}
        enabled={enabled && seen}
      />
    );
  },
);
InviewSeen.displayName = "InviewSeen";
