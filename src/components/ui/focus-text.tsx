"use client";

import type { ReactNode } from "react";

import { InviewSeen } from "@/components/ui/inview-seen";
import { SPRING_SOFT } from "@/lib/motion";
import type { Tags } from "@/types/springs";

const MASK = "linear-gradient(90deg, black calc(var(--reveal) - 40%), transparent var(--reveal))";

/**
 * Any heading or paragraph that should appear the way the section titles do:
 * out of a blur, with a soft mask sweeping left → right so the text resolves
 * in reading order (motion brief shared.title "Focus pull"). Plays once when
 * the element is properly on screen.
 */
export const FocusText = ({
  tag = "p",
  className = "",
  delay = 0,
  children,
}: {
  tag?: Tags;
  className?: string;
  delay?: number;
  children: ReactNode;
}) => (
  <InviewSeen
    tag={tag}
    mode="once"
    from={{ opacity: 0, filter: "blur(8px)", "--reveal": "0%" }}
    to={{ opacity: 1, filter: "blur(0px)", "--reveal": "140%" }}
    config={SPRING_SOFT}
    delayIn={delay}
    style={{ maskImage: MASK, WebkitMaskImage: MASK }}
    className={className}
  >
    {children}
  </InviewSeen>
);
