"use client";

import { useReducedMotion } from "@react-spring/web";
import type { ReactNode } from "react";

import { SpringTrigger } from "@/components/animation/springs/spring-trigger";

/** Scroll drift, px either side of the resting position. */
const DRIFT = 40;

/**
 * Bloom layer that drifts with scroll (motion brief, proof "Drift with
 * scroll"). The box covers the whole section, so progress runs 0 → 1 from
 * the section's top touching the viewport bottom to its bottom leaving the
 * top — 0.5 (no offset, the Figma position) when the section is centred.
 */
export const BloomDrift = ({
  direction,
  children,
}: {
  /** 1 drifts down as the page scrolls, -1 drifts up. */
  direction: 1 | -1;
  children: ReactNode;
}) => {
  const reduced = useReducedMotion();
  const range = reduced ? 0 : DRIFT * direction;

  return (
    <SpringTrigger
      mode="scrub"
      className="absolute inset-0"
      innerClassName="absolute inset-0"
      from={{ y: -range }}
      to={{ y: range }}
    >
      {children}
    </SpringTrigger>
  );
};
