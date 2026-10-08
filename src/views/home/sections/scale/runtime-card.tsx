"use client";

import { useRef } from "react";

import { TypeText } from "@/components/ui/type-text";
import type { ScaleContent } from "@/data/mocks/home/scale";
import { REVEAL } from "@/lib/motion";

import { ScaleCard } from "./card";
import { RuntimeHub } from "./runtime-hub";
import { ScaleType } from "./scale-type";

type RuntimeCardProps = ScaleContent["runtime"] & { index: number };

const MONO_DIM =
  "font-mono text-scale-mono leading-scale-mono text-foreground-dim";

/**
 * Card / One runtime, every app — 3888:6454 (art 3888:6457), 3949:13127,
 * 3832:8118, 3893:3752. Label and caption sit outside the hub group in every
 * frame: (24, 24 / 292), (0, 0 / 256), (0, 24 / 296), (0, 0 / 236).
 */
export const RuntimeCard = ({
  title,
  copy,
  label,
  caption,
  apps,
  index,
}: RuntimeCardProps) => {
  const top = useRef<HTMLParagraphElement>(null);
  return (
    <ScaleCard
      title={title}
      copy={copy}
      index={index}
      clipArt={false}
      artClassName="w390:h-62.75"
    >
      <RuntimeHub label={label} apps={apps} />
      <p
        className={`absolute top-73 left-0 w-129.5 w1024:top-64 w1024:left-0 w1024:w-89.5 w768:top-74 w768:w-160 w390:top-59 w390:w-77.5 ${MONO_DIM}`}
      >
        <ScaleType trigger={top} delay={(index + 5) * REVEAL.step}>
          {`${caption} `}
        </ScaleType>
      </p>
      <p
        ref={top}
        className={`absolute top-6 left-0 w-129.5 w1024:top-0 w1024:left-0 w1024:w-89.5 w768:top-6 w768:w-160 w390:top-0 w390:w-77.5 ${MONO_DIM}`}
      >
        <TypeText delay={(index + 2) * REVEAL.step}>{`${label} `}</TypeText>
      </p>
    </ScaleCard>
  );
};
