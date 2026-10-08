import { Suspense } from "react";

import { navMock } from "@/data/mocks/home/nav";
import { Backdrop } from "@/views/home/sections/backdrop";
import { Nav } from "@/views/home/sections/nav";
import { CursorDot } from "@/components/ui/cursor-dot";
import { LogoOpen } from "@/views/home/transitions/logo-open";
import { ScrollBlur } from "@/views/home/transitions/scroll-blur";
import { Hero } from "@/views/home/sections/hero";
import { heroMock } from "@/data/mocks/home/hero";
import { Integrations } from "@/views/home/sections/integrations";
import { integrationsMock } from "@/data/mocks/home/integrations";
import { Product } from "@/views/home/sections/product";
import { productMock } from "@/data/mocks/home/product";
import { Statement } from "@/views/home/sections/statement";
import { statementMock } from "@/data/mocks/home/statement";
import { Scale } from "@/views/home/sections/scale";
import { scaleMock } from "@/data/mocks/home/scale";
import { Signals } from "@/views/home/sections/signals";
import { signalsMock } from "@/data/mocks/home/signals";
import { Proof } from "@/views/home/sections/proof";
import { proofMock } from "@/data/mocks/home/proof";
import { Pricing } from "@/views/home/sections/pricing";
import { pricingMock } from "@/data/mocks/home/pricing";
import { Footer } from "@/views/home/sections/footer";
import { Preloader } from "@/views/home/preloader";
import { ParticleStream } from "@/views/home/stream/particle-stream";
import { footerMock } from "@/data/mocks/home/footer";

/**
 * Home view — the Relay landing page, drawn as four Figma frames: 1440
 * (3888:2736), 1024 (3888:7141), 768 (3832:4407) and 390 (3893:2); the
 * narrower ones are `w1024:` / `w768:` / `w390:` variants (see globals.css).
 * A Server Component: every section below is a server shell with client
 * animation leaves. Section heights are the frames' own.
 * Block-to-block transitions (motion brief t1–t8) wrap the sections here, so
 * each section stays unaware of its neighbours.
 *
 * Every block below the hero sits in its own `<Suspense>` (no fallback — all
 * of it is in the server HTML): React then hydrates the first screen first
 * and each block after it in a task of its own, yielding in between, instead
 * of the whole page in one ~1 s task on a phone (ADR-0028).
 */
export const HomeView = () => (
  <>
    <Preloader />
    {/* The page column centres between the frames' widths; decorations may
        bleed past it into the margins, clipped at the viewport here. */}
    <div className="overflow-x-clip">
      <main className="relative mx-auto w-page overflow-y-clip">
        <Backdrop />
        {/* the lime particle stream: fixed to the viewport over the backdrop,
            under every section, laid out along the whole page */}
        <ParticleStream />
        <Nav {...navMock} />
        {/* the nav is fixed; this keeps its slot in the flow (88, 64 at 768, 56 at 390) */}
        <div aria-hidden="true" className="h-22 w768:h-16 w390:h-14" />
        <Hero {...heroMock} />
        {/* t2 — blur hand-off */}
        <Suspense>
          <ScrollBlur leave still>
            <Integrations {...integrationsMock} />
          </ScrollBlur>
        </Suspense>
        {/* section rhythm: 1.5× the frames' gaps (h-section-gap between blocks) */}
        <div aria-hidden="true" className="h-section-gap" />
        {/* Product → Proof sit on one frosted slab (not in Figma), bled to the
            viewport's edges, so the stream underneath reads through it. */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-[calc(50%-50vw)] left-[calc(50%-50vw)] border-y border-glass-slab-edge bg-glass-slab backdrop-blur-glass-slab"
          />
          <Suspense>
            <ScrollBlur enter>
              <Product {...productMock} />
            </ScrollBlur>
          </Suspense>
          <div aria-hidden="true" className="h-section-gap" />
          {/* t3 + t4 — the lime plate grows out of the Relay logo and folds back into it */}
          <Suspense>
            <LogoOpen>
              <Statement {...statementMock} />
            </LogoOpen>
          </Suspense>
          <div aria-hidden="true" className="h-section-gap" />
          {/* t5 t6 t7 — blur hand-offs */}
          <Suspense>
            <ScrollBlur leave>
              <Scale {...scaleMock} />
            </ScrollBlur>
          </Suspense>
          <div aria-hidden="true" className="h-section-gap" />
          <Suspense>
            <ScrollBlur enter leave>
              <Signals {...signalsMock} />
            </ScrollBlur>
          </Suspense>
          <div aria-hidden="true" className="h-section-gap" />
          <Suspense>
            <ScrollBlur enter leave>
              <Proof {...proofMock} />
            </ScrollBlur>
          </Suspense>
        </div>
        <div aria-hidden="true" className="h-section-gap" />
        {/* t8 — pricing hands over to the footer by plain scroll; its cards
        simply sit there, only their contents animate in (client call) */}
        <Suspense>
          <Pricing {...pricingMock} />
        </Suspense>
        <div aria-hidden="true" className="h-section-gap" />
        <Suspense>
          <Footer {...footerMock} />
        </Suspense>
        <CursorDot />
      </main>
    </div>
  </>
);
