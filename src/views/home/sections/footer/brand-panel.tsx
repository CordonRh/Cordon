import Link from "@/components/compat/link";
import { Icon } from "@/components/cordon/shared";

import type { FooterContent } from "@/data/mocks/home/footer";

import { LogoMark } from "./logo-mark";
import { PanelGlyph } from "./panel-glyph";
import { CUE, CueFade, CueFocus, CueLine, CueRise } from "./stage";

/**
 * Brand panel 3888:7058 — 530 × 320 at (80, 96); 1024 3888:11469 —
 * 459 × 278 at (48, 0); 768 3876:97 — 688 × 278 at (40, 40); 390 3954:695 —
 * 350 × 309 at (20, 0). Children are placed from the padding box (inside
 * the 1px border), hence the Figma x/y minus one.
 * On the footer timeline it follows the CTA: tagline, hairline, then the
 * social row fades in as one.
 */
export const BrandPanel = ({
  name,
  href,
  tagline,
  socialLabel,
  socials,
}: FooterContent["brand"]) => (
  <CueRise
    stage="top"
    delay={CUE.brandPanel}
    className="absolute top-24 left-20 h-80 w-132.5 overflow-clip rounded-footer-panel border border-footer-panel-border bg-linear-[148.88deg_in_srgb] bg-origin-border from-footer-panel-from via-footer-panel-via via-55% to-footer-panel-to w1024:top-0 w1024:left-12 w1024:h-69.5 w1024:w-114.75 w768:top-10 w768:left-10 w768:w-172 w390:top-0 w390:left-5 w390:h-77.25 w390:w-87.5"
  >
    <PanelGlyph />

    <Link
      href={href}
      className="absolute top-7.75 left-7.75 flex items-center gap-3 w1024:top-5.75 w1024:left-5.75 w390:left-4.75"
    >
      <LogoMark size="md" />
      <span className="text-footer-wordmark leading-footer-wordmark font-medium tracking-wordmark text-foreground">
        {name}
      </span>
    </Link>

    <CueFocus
      stage="top"
      delay={CUE.tagline}
      className="absolute top-41.5 left-7.75 w-90 text-lead leading-lead text-foreground w1024:top-33 w1024:left-5.75 w1024:w-61.75 w768:top-31 w768:w-73 w390:top-38.75 w390:left-4.75 w390:w-77.5"
    >
      {tagline}
    </CueFocus>

    <CueLine
      stage="top"
      delay={CUE.brandLine}
      className="absolute top-59.5 left-7.75 h-px w-116.5 bg-footer-panel-hairline w1024:top-51 w1024:left-5.75 w1024:w-102.75 w768:top-49 w768:w-160 w390:top-58.75 w390:left-4.75 w390:w-77.5"
    />

    <CueFade stage="top" delay={CUE.social}>
      <p
        id="footer-social-label"
        className="absolute top-66.75 left-7.75 font-mono text-label leading-label tracking-footer-mono whitespace-nowrap text-foreground-muted w1024:top-58.25 w1024:left-5.75 w768:top-58.25 w390:top-66 w390:left-4.75"
      >
        {socialLabel}
      </p>
      <ul
        aria-labelledby="footer-social-label"
        className="absolute top-63.75 left-86.25 flex items-center gap-2 w1024:top-55.25 w1024:left-70.5 w768:left-127.75 w390:top-63 w390:left-44.25"
      >
        {socials.map((social) => (
          <li key={social.name}>
            <Link
              href={social.href}
              {...(social.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              aria-label={social.name}
              className="flex size-8 items-center justify-center overflow-clip rounded-footer-chip border border-footer-social-border bg-footer-social-fill font-mono text-label leading-label text-footer-social-label transition-colors duration-(--motion-fast) ease-entrance hover:text-foreground"
            >
              <Icon name={social.name.toLowerCase()} className="size-4"/>
            </Link>
          </li>
        ))}
      </ul>
    </CueFade>
  </CueRise>
);
