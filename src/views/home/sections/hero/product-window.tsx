import Image from "@/components/compat/image";
import { Fragment } from "react";

import { Reveal } from "@/components/ui/reveal";
import type { HeroContent } from "@/data/mocks/home/hero";
import { REVEAL } from "@/lib/motion";

import {
  Connectors,
  FlowLive,
  GridWave,
  Packets,
  PortFlash,
  PortIn,
} from "./flow-live";
import { DepthLayer, TiltGroup } from "./hero-tilt";
import { LiveRuns } from "./live-runs";
import { LOAD, TILT } from "./timeline";
import { WindowNode } from "./window-node";

type ProductWindowProps = HeroContent["window"];

/**
 * In-window ports. The Amount / Log in-ports end the true / else fan-out
 * (3684:95); their out-ports draw with the right connectors, Ask finance's
 * lights on arrival. Refund created's out-port sits with its card (below).
 *
 * 1024 draws no ports (only the flash, at the branch card's in-port). 768
 * (3885:12 … 3885:16) draws all of them — the two `id: null` entries are the
 * branch cards' out-ports there, the flash ids sit on the in-ports as at 1024.
 */
const PORTS = [
  {
    id: null,
    pos: "top-48.75 left-41.25",
    flash1024: "",
    at768: "w768:top-77.5 w768:left-37.25",
    delay: LOAD.connectors,
  },
  {
    id: null,
    pos: "top-88.75 left-41.25",
    flash1024: "",
    at768: "w768:top-77.5 w768:left-89.25",
    delay: LOAD.connectors,
  },
  {
    id: "condition",
    pos: "top-48.75 left-93.75",
    flash1024: "w1024:top-63.25 w1024:left-34.75",
    at768: "w768:top-62.5 w768:left-37.25",
    delay: LOAD.connectors,
  },
  {
    id: "log",
    pos: "top-88.75 left-93.75",
    flash1024: "w1024:top-63.25 w1024:left-91.75",
    at768: "w768:top-62.5 w768:left-89.25",
    delay: LOAD.connectors,
  },
  {
    id: "approval",
    pos: "top-68.75 left-113.75",
    flash1024: "w1024:top-95.25 w1024:left-63.25",
    at768: "w768:top-93.5 w768:left-63.25",
    delay: LOAD.targetPort,
  },
] as const;

/** Branch label 3685:11 / 3685:13 — 53 × 30 chip sitting on the connector. */
const BranchLabel = ({
  label,
  className,
}: {
  label: string;
  className: string;
}) => (
  <p
    className={`absolute overflow-clip rounded-hero-wait border border-border-subtle bg-hero-label backdrop-blur-hero-card px-1.75 py-0.75 font-mono text-label leading-label whitespace-nowrap text-foreground-muted ${className}`}
  >
    {label}
  </p>
);

/**
 * Product window group 3542:24364. The window (3542:24365) is 680 × 624 at
 * x760 y44 with a 1px inside border, so its children use Figma's positions
 * minus 1. "Refund created" and its port overhang the window to the left.
 *
 * Motion: load sequence (frame → grid wave → nodes → connectors → packet, see
 * ./timeline), the live packet loop + runs feed, and the cursor tilt with
 * grid / flow / front parallax layers at 4 / 8 / 12 px.
 */
export const ProductWindow = ({
  label,
  title,
  meta,
  status,
  zoom,
  tools,
  trigger,
  condition,
  log,
  branches,
  approval,
  wait,
  runsLabel,
  runs,
  runPool,
  runGaps,
}: ProductWindowProps) => (
  <div className="hero-workflow-stage pointer-events-none absolute inset-0">
  <TiltGroup className="absolute inset-0">
    <FlowLive className="absolute inset-0">
      {/* The window itself is there from the first frame (client call): a
          fade on its wrapper suppressed the glass (backdrop-filter) until it
          ended. Only its contents play the load sequence. */}
      <div className="absolute inset-0">
        <div role="group" aria-label={label}>
          <div className="absolute top-11 left-190 h-156 w-170 overflow-clip rounded-hero-window border border-transparent [background:var(--hero-window-surface)] backdrop-blur-hero-window w1024:top-6.75 w1024:left-127 w1024:h-164.75 w1024:w-129 w768:top-88.5 w768:left-31.5 w768:h-147.5 w390:top-105.5 w390:left-5 w390:h-128.75 w390:w-87.5">
            <DepthLayer depth={TILT.depth.grid} className="absolute inset-0">
              <GridWave>
                <Image
                  src="/assets/hero/hero-canvas-grid.svg"
                  alt=""
                  width={680}
                  height={624}
                  className="absolute -top-px -left-px h-156 w-170 max-w-none w1024:h-164.75 w1024:w-129 w768:-top-9 w768:h-147.5 w390:-top-18.25 w390:w-87.5"
                />
              </GridWave>
            </DepthLayer>

            <Reveal
              variant="fade"
              delay={LOAD.chrome}
              className="absolute inset-0"
            >
              <span
                aria-hidden
                className="absolute top-3.75 left-3.75 size-1 rounded-full bg-hero-corner-dot w1024:hidden"
              />
              <span
                aria-hidden
                className="absolute top-150.75 left-3.75 size-1 rounded-full bg-hero-corner-dot w1024:hidden"
              />
              {/* 1024 keeps a single dot, top right (3699:828). */}
              <span
                aria-hidden
                className="absolute -top-0.25 left-124.75 hidden size-1 rounded-full bg-hero-corner-dot w1024:block w390:left-83.25"
              />

              {/* Top bar */}
              <p className="absolute top-9.75 left-9.75 text-body leading-body whitespace-nowrap text-foreground-muted w1024:top-5.75 w1024:left-5.75 w390:left-4.75">
                {title}
              </p>
              <span
                aria-hidden
                className="absolute top-11 left-50.75 h-3.5 w-px bg-hero-bar-divider w1024:top-7 w1024:left-46.75 w390:hidden"
              />
              <p className="absolute top-10.25 left-55.75 font-mono text-label leading-label whitespace-nowrap text-hero-ink w1024:top-6.25 w1024:left-50.75 w390:hidden">
                {meta}
              </p>
              <span
                aria-hidden
                className="absolute top-21.75 -left-px h-px w-170 bg-hero-rule w1024:top-15.75 w1024:w-129 w390:w-87.5"
              />

              {/* Tool column + zoom */}
              <ul
                aria-label="Workspace tools"
                className="absolute top-27.75 left-9.75 flex flex-col gap-2 w1024:top-19 w1024:left-5.75 w1024:flex-row w390:left-4.75"
              >
                {tools.map((tool, i) => (
                  <li key={tool.name} className="relative size-9">
                    <a
                      href={tool.name === "code" ? "/docs" : tool.name === "redirect" ? "/dashboard/settlement" : "/dashboard/bundles"}
                      aria-label={`Open ${tool.name === "code" ? "documentation" : tool.name === "redirect" ? "settlement" : "bundles"}`}
                      className={`pointer-events-auto relative flex size-full items-center justify-center overflow-clip rounded-hero-tool border ${i === 0 ? "border-hero-tool-active-border bg-hero-tool-active-fill" : "border-hero-tool-border bg-hero-tool-fill"}`}
                    >
                      <Image
                        src={tool.icon}
                        alt=""
                        width={20}
                        height={20}
                        className="size-5"
                      />
                    </a>
                  </li>
                ))}
              </ul>
              <div className="absolute top-27.75 left-145.25 w1024:top-19 w1024:left-108 w390:left-67.5">
                <p className="relative overflow-clip rounded-hero-chip border border-hero-zoom-border bg-hero-zoom-fill px-2.75 py-1.25 font-mono text-label leading-label whitespace-nowrap text-foreground-muted w1024:py-1.75">
                  {zoom}
                </p>
              </div>
            </Reveal>
            <Reveal
              tag="p"
              variant="fade"
              delay={LOAD.status}
              className="absolute top-10.25 left-119.75 w-40 text-right font-mono text-label leading-label text-accent w1024:top-6.25 w1024:left-82.75 w390:left-42.25"
            >
              {status}
            </Reveal>

            {/* Flow */}
            <DepthLayer depth={TILT.depth.flow} className="absolute inset-0">
              {/* 390 (3957:1556) is the 768 flow scaled 310 / 380 about its
                  top-left (67, 130), shifted 48 left. */}
              <div className="absolute inset-0 w390:origin-[calc(var(--spacing)*16.75)_calc(var(--spacing)*32.5)] w390:-translate-x-12 w390:scale-[0.8158]">
                <Connectors
                  mirror
                  className="absolute top-47.25 left-22.25 h-45 w-20 w1024:left-35.75 w1024:h-17 w1024:w-57 w768:top-47.5 w768:left-38.25 w768:h-16 w768:w-52"
                />
                <Connectors className="absolute top-47.25 left-94.75 h-45 w-20 w1024:top-79.25 w1024:left-35.75 w1024:h-17 w1024:w-57 w768:top-78.5 w768:left-38.25 w768:h-16 w768:w-52" />
                <Packets />
                <WindowNode
                  {...condition}
                  glow
                  delay={LOAD.nodes[1]}
                  className="top-40.5 left-42.25 w-52.5 w1024:top-64.25 w1024:left-12.25 w1024:w-47 w768:top-63.5 w768:left-16.75 w768:w-43"
                />
                <WindowNode
                  {...log}
                  delay={LOAD.nodes[2]}
                  className="top-80.5 left-42.25 w-52.5 w1024:top-64.25 w1024:left-69.25 w1024:w-47 w768:top-63.5 w768:left-68.75 w768:w-43"
                />
                <WindowNode
                  {...approval}
                  delay={LOAD.nodes[3]}
                  className="hero-settlement-node top-60.5 left-114.75 w-47 w1024:top-96.25 w1024:left-40.75 w1024:w-47 w768:top-94.5 w768:left-42.75 w768:w-43"
                />
                <Reveal
                  variant="fade"
                  delay={LOAD.nodes[3] + REVEAL.step}
                  className="absolute top-82 left-114.75 w1024:top-115.25 w1024:left-53 w768:top-113.5"
                >
                  <p className="relative flex items-center gap-2 overflow-clip rounded-hero-wait border border-hero-zoom-border bg-hero-wait-chip backdrop-blur-hero-card px-2.75 py-0.75">
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full bg-hero-wait-dot"
                    />
                    <span className="font-mono text-label leading-label whitespace-nowrap text-foreground-muted">
                      {wait}
                    </span>
                  </p>
                </Reveal>
                <Reveal
                  variant="fade"
                  delay={LOAD.connectors}
                  className="absolute inset-0"
                >
                  <BranchLabel
                    label={branches.yes}
                    className="top-54 left-26 w1024:top-52 w1024:left-43.5 w768:top-51.75 w768:left-42.5"
                  />
                  <BranchLabel
                    label={branches.no}
                    className="top-78.5 left-26 w1024:top-52 w1024:left-72 w768:top-51.75 w768:left-72.75"
                  />
                </Reveal>
                {PORTS.map(({ id, pos, flash1024, at768, delay }) => (
                  <Fragment key={pos}>
                    {id && (
                      <PortFlash
                        id={id}
                        className={`${pos} ${flash1024} ${at768}`}
                      />
                    )}
                    <PortIn
                      delay={delay}
                      className={`size-2 ${pos} w1024:hidden w768:block ${at768}`}
                    >
                      <Image
                        src="/assets/hero/hero-port.svg"
                        alt=""
                        width={8}
                        height={8}
                        className="block size-2"
                      />
                    </PortIn>
                  </Fragment>
                ))}
              </div>
            </DepthLayer>

            {/* Last runs */}
            <Reveal
              variant="fade"
              delay={LOAD.chrome}
              className="absolute inset-0"
            >
              <span
                aria-hidden
                className="absolute top-110.25 left-9.75 h-px w-150 bg-hero-rule w1024:top-126.25 w1024:left-5.75 w1024:w-117 w768:top-125 w390:top-108.75 w390:left-4.75 w390:w-77.5"
              />
              <p className="absolute top-115.25 left-9.75 font-mono text-label leading-label whitespace-nowrap text-foreground-dim w1024:top-130.5 w1024:left-5.75 w768:top-128.25 w390:top-112 w390:left-4.75">
                {runsLabel}
              </p>
            </Reveal>
            <LiveRuns runs={runs} pool={runPool} gaps={runGaps} />
          </div>

          {/* The window's gradient stroke, on its own ring over the glass. */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-11 left-190 h-156 w-170 w1024:top-6.75 w1024:left-127 w1024:h-164.75 w1024:w-129 w768:top-88.5 w768:left-31.5 w768:h-147.5 w390:top-105.5 w390:left-5 w390:h-128.75 w390:w-87.5 rounded-hero-window border border-transparent [background:var(--hero-window-ring)_border-box] [mask:var(--hero-window-ring-mask)]"
          />

          {/* Same depth as the flow: its connector leaves this card's edge. */}
          <DepthLayer depth={TILT.depth.flow} className="absolute inset-0">
            <WindowNode
              {...trigger}
              delay={LOAD.nodes[0]}
              className="top-72 left-162.5 w-50 w1024:top-38.75 w1024:left-168 w1024:w-47 w768:top-121.25 w768:left-74.5 w768:h-15 w768:w-43 w768:pt-2.75 w390:top-138.25 w390:left-31.25 w390:origin-top-left w390:scale-[0.8158]"
            />
            {/* Out-port on the card's right edge, start of the true / else fan-out:
                window padding (85, 275) + window origin (761, 45) in hero space. */}
            <PortFlash
              id="trigger"
              className="top-80 left-211.5 w1024:top-53.25 w1024:left-190.5 w768:top-135.25 w768:left-95 w390:top-149.75 w390:left-48 w390:size-1.75"
            />
            <PortIn
              delay={LOAD.connectorsIn}
              className="top-80 left-211.5 size-2 w1024:hidden w768:block w768:top-135.25 w768:left-95 w390:top-149.75 w390:left-48 w390:size-1.75"
            >
              <Image
                src="/assets/hero/hero-port.svg"
                alt=""
                width={8}
                height={8}
                className="block size-full"
              />
            </PortIn>
            <PortIn
              delay={LOAD.nodes[0]}
              className="top-80.25 left-161.5 size-2 w1024:hidden"
            >
              <Image
                src="/assets/hero/hero-port-overhang.svg"
                alt=""
                width={8}
                height={8}
                className="block size-2"
              />
            </PortIn>
          </DepthLayer>
        </div>
      </div>
    </FlowLive>
  </TiltGroup>
  </div>
);
