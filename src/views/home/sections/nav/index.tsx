import Image from "@/components/compat/image";
import Link from "@/components/compat/link";

import { PillButton } from "@/components/ui/pill-button";
import { Reveal } from "@/components/ui/reveal";
import type { NavContent } from "@/data/mocks/home/nav";

import { BreathingDot } from "./breathing-dot";
import { NavMenu } from "./nav-menu";
import { NavShell } from "./nav-shell";

/**
 * 01 Navigation. Brand, links and actions spread by `justify-between`, which
 * is what puts the link row where each frame has it:
 * - 1440 × 88, inset 80, link gap 40 — links at x=413 (3888:4858)
 * - 1024 × 88, inset 48, gap 32 — x=217 (3888:9263)
 * - 768 × 64, inset 32, gap 24 — x=205.5; status pill hidden, wordmark
 *   18 px (3832:6530)
 * - 390 × 56, inset 20 — links and status hidden, wordmark 16 px, CTA plus a
 *   menu button that opens the links in a panel (3893:2123)
 */
export const Nav = ({ brand, links, status, cta }: NavContent) => (
  <NavShell>
    <Reveal
      tag="header"
      variant="fade"
      className="relative z-10 mx-auto flex h-22 w-page items-center justify-between px-page-inset w768:h-16 w768:px-8 w390:h-14 w390:px-page-inset"
    >
      <Link href={brand.href} className="flex items-center gap-3">
        <Image
          src="/brand/cordon-symbol.png"
          alt=""
          width={28}
          height={28}
          className="size-7"
          priority
        />
        <span className="text-wordmark leading-lead font-medium w768:text-lead w390:text-body w390:leading-body tracking-wordmark text-foreground">
          {brand.name}
        </span>
      </Link>

      <nav aria-label="Primary" className="w390:hidden">
        <ul className="flex items-center gap-10 text-label leading-label w1024:gap-8 w768:gap-6 text-foreground-muted">
          {links.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                className="whitespace-nowrap transition-colors duration-(--motion-fast) ease-entrance hover:text-accent"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex items-center gap-3 w390:gap-2">
        <p className="flex h-11 items-center w768:hidden gap-2 overflow-clip rounded-full border border-border-glass bg-surface-status px-4 shadow-float">
          <BreathingDot />
          <span className="font-mono text-label leading-label whitespace-nowrap text-foreground">
            {status}
          </span>
        </p>
        <PillButton href={cta.href}>{cta.label}</PillButton>
        <NavMenu links={links} />
      </div>
    </Reveal>
  </NavShell>
);
