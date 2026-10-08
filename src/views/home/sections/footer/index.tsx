import type { FooterContent } from "@/data/mocks/home/footer";

import { BrandPanel } from "./brand-panel";
import { CtaPanel } from "./cta-panel";
import { Glows } from "./glows";
import { LinkArea } from "./link-area";
import { CUE, CueFade, CueLine, FooterStage } from "./stage";
import { StatusRow } from "./status-row";

/**
 * 10 Footer — 1440 × 772 (Figma 3888:7053). 1024 × 710 (3888:11464): the
 * panels sit in a 928-wide row at y 0. 768 × 1084 (3876:92): the panels
 * stack full width, the columns drop under the company block. 390 × 1229
 * (3893:4376): the statuses and the legal lines stack too.
 * Everything sits at the frame's absolute coordinates. The aurora glows
 * overhang upward into Pricing, so the footer itself does not clip; the page
 * `main` clips horizontally.
 */
export const Footer = ({
  brand,
  cta,
  statuses,
  company,
  columns,
  legal,
}: FooterContent) => (
  <footer
    id="footer"
    aria-label="Site footer"
    className="[content-visibility:auto] relative h-191 w1024:h-161.5 w768:h-271 w390:h-309.25"
  >
    <Glows />
    <FooterStage>
      <BrandPanel {...brand} />
      <CtaPanel {...cta} />
      <StatusRow statuses={statuses} />

      <CueLine
        stage="bottom"
        delay={CUE.bottomLine}
        className="absolute top-125.5 left-20 h-px w-320 bg-footer-hairline w1024:top-90.5 w1024:left-12 w1024:w-232 w768:top-171 w768:left-10 w768:w-172 w390:top-192.25 w390:left-5 w390:w-87.5"
      />
      <LinkArea company={company} columns={columns} />
      <CueLine
        stage="bottom"
        delay={CUE.footLine}
        className="absolute top-173.75 left-20 h-px w-320 bg-footer-hairline w1024:top-144.25 w1024:left-12 w1024:w-232 w768:top-253.75 w768:left-10 w768:w-172 w390:top-286 w390:left-5 w390:w-87.5"
      />

      {/*
        Legal band y714–740. Figma has the copyright (3488:22920, y720) 6px
        below "built in Lisbon and Kraków" (3488:22939, y714); the designer
        asked for one baseline, so both sit on y714. 1024 (y666) and 768
        (y1040) draw both on one baseline; 390 stacks them (3949:13037, y1161,
        8 apart).
      */}
      <CueFade
        stage="bottom"
        delay={CUE.legal}
        className="absolute top-180 left-20 flex h-6.5 w-320 justify-between font-mono text-label leading-label text-foreground-dim w1024:top-150.5 w1024:left-12 w1024:h-5 w1024:w-232 w768:top-260 w768:left-10 w768:w-172 w390:top-292.25 w390:left-5 w390:h-12 w390:w-87.5 w390:flex-col w390:gap-2"
      >
        <p>{legal.copyright}</p>
        <p className="text-right w390:text-left">{legal.origin}</p>
      </CueFade>
    </FooterStage>
  </footer>
);
