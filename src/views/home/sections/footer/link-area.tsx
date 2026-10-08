import Link from "@/components/compat/link";

import type { FooterContent } from "@/data/mocks/home/footer";

import { LogoMark } from "./logo-mark";
import { CUE, CueRise } from "./stage";

/**
 * 1440 row 3888:7101 (x80 y533): columns at x 630, 803, 973, 1132, y 533.
 * 1024 row 3888:11516 (x48 y443): a 151 pitch from x 396, 7 below the company
 * block (y 450). 768 row 3876:144 (x40 y709): company block full width, then
 * four 160 columns (pitch 176) from x 40 at y 855. 390 row 3893:4427 (x20
 * y786): company block, then four 77 columns (pitch 91) from x 20 at y 976.
 */
const LEFT = [
  "left-157.5 w1024:left-99 w768:left-10 w390:left-5",
  "left-200.75 w1024:left-136.75 w768:left-54 w390:left-27.75",
  "left-243.25 w1024:left-174.5 w768:left-98 w390:left-50.5",
  "left-283 w1024:left-212.25 w768:left-142 w390:left-73.25",
] as const;

/**
 * Company block and link columns — the bottom of the footer timeline. Each
 * block rises once as a whole, columns a beat apart; nothing inside types.
 * Links turn lime on hover / keyboard focus (colour transition, like the nav).
 */
export const LinkArea = ({
  company,
  columns,
}: Pick<FooterContent, "company" | "columns">) => (
  <>
    <CueRise
      stage="bottom"
      delay={CUE.company}
      className="absolute top-133.25 left-20 w-100 w1024:top-98.75 w1024:left-12 w1024:w-75 w768:top-177.25 w768:left-10 w768:w-172 w390:top-198.5 w390:left-5 w390:w-87.5"
    >
      <LogoMark size="sm" />
      <p className="absolute top-0.25 left-9 text-body leading-body font-medium whitespace-nowrap text-foreground w1024:left-9.5 w768:text-lead w390:text-body">
        {company.name}
      </p>
      <p className="absolute top-10.5 left-0 w-100 text-body leading-body text-foreground-muted w1024:w-62 w768:w-172 w390:w-87.5">
        {company.copy}
      </p>
      <p className="absolute top-27.5 left-0 font-mono text-label leading-label whitespace-nowrap text-foreground-dim w1024:w-59.25 w1024:whitespace-normal w768:top-21.5 w768:w-172 w390:top-27.5 w390:w-87.5">
        {company.compliance}
      </p>
    </CueRise>

    <nav aria-label="Footer">
      {columns.map((column, i) => (
        <CueRise
          key={column.title}
          stage="bottom"
          delay={CUE.column + i * CUE.columnStep}
          className={`absolute top-133.25 flex flex-col gap-3 w1024:top-100.5 w768:top-213.75 w390:top-246 ${LEFT[i]}`}
        >
          <p
            id={`footer-col-${column.title}`}
            className="font-mono text-label leading-label whitespace-nowrap text-foreground-dim"
          >
            {column.title}
          </p>
          <ul
            aria-labelledby={`footer-col-${column.title}`}
            className="flex flex-col gap-1.5 w1024:gap-2"
          >
            {column.links.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  className="block text-label leading-label whitespace-nowrap text-foreground-muted transition-colors duration-(--motion-fast) ease-entrance hover:text-accent focus-visible:text-accent"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </CueRise>
      ))}
    </nav>
  </>
);
