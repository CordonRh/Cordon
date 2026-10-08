/**
 * Composition layer of the page-long particle stream (./stream-scene) — kept
 * apart from the scene so the page can resolve the path without three.js.
 *
 * The stream is one Catmull-Rom sweep from above the hero down to below the
 * footer. Its waypoints are anchored to the page's blocks, not to pixels:
 * `x` is a share of the page column's width, `y` a share of the anchored
 * block's height (the block is the section itself, or — for a section inside
 * a sticky layer, like Statement — the layer's flow wrapper, so a stuck
 * section does not drag it). The same list therefore holds at every
 * breakpoint and viewport height; only the hero's part, where the product
 * window sits in a different place per frame, is drawn per frame.
 *
 * Every waypoint sits lower on the page than the one before, so the flow runs
 * strictly top → bottom.
 */

export type Waypoint = {
  /** id of the section the point is anchored to */
  at: string;
  /** share of the page column's width (0 = left edge; may overshoot) */
  x: number;
  /** share of the anchored block's height (may overshoot) */
  y: number;
  /** depth: + toward the camera (bigger, softer), − away */
  z: number;
  /** 0…1 — how tightly the strands pinch here, and how hot they burn */
  pinch?: number;
};

/**
 * Hero, per frame: in from above the top right, down-left behind the glass
 * window, turning just left of it (the hot pinch), then back right toward
 * the Integrations tile row. Traced from the 1440 frame (window x 760…1440).
 */
const HERO = {
  1440: [
    { at: "hero", x: 1.14, y: -0.46, z: -2.6 },
    { at: "hero", x: 0.84, y: 0.02, z: -1.8 },
    { at: "hero", x: 0.5, y: 0.3, z: -0.9 },
    // a wide swing well left of the window (x ≈ .36 after the shift), back
    // right to the tile gap — the intended big rotation
    { at: "hero", x: 0.22, y: 0.66, z: 0, pinch: 1 },
  ],
  /** window x 508…1024 of 1024 */
  1024: [
    { at: "hero", x: 1.08, y: -0.4, z: -2.6 },
    { at: "hero", x: 0.86, y: 0.03, z: -1.8 },
    { at: "hero", x: 0.5, y: 0.35, z: -0.9 },
    { at: "hero", x: 0.22, y: 0.7, z: 0, pinch: 1 },
  ],
  /** the window is stacked under the copy (x 126…642 of 768, y 354…944) */
  768: [
    { at: "hero", x: 1.08, y: 0.12, z: -2.4 },
    { at: "hero", x: 0.8, y: 0.4, z: -1.6 },
    { at: "hero", x: 0.3, y: 0.6, z: -0.8 },
    { at: "hero", x: -0.02, y: 0.8, z: 0, pinch: 1 },
  ],
  /** 390: the window spans the width — the stream runs behind its glass */
  390: [
    { at: "hero", x: 1.1, y: 0.2, z: -2.4 },
    { at: "hero", x: 0.75, y: 0.45, z: -1.6 },
    { at: "hero", x: 0.25, y: 0.65, z: -0.8 },
    { at: "hero", x: -0.02, y: 0.84, z: 0, pinch: 1 },
  ],
} as const satisfies Record<number, readonly Waypoint[]>;

/**
 * Below the hero, shared by every frame: the S the client drew — back right
 * through the gap between two Integrations tiles — then few, wide bends that
 * swing wide (left in Product, right across Scale / Signals, left in Proof,
 * one broad, round arc right through Pricing), and finally a sweep out
 * through the left edge above the footer, so the stream never crosses it.
 * Values are before `SHIFT`.
 */
const TAIL: readonly Waypoint[] = [
  // into the tile gap nearly straight down and out of it the same way, then
  // a wide turn left — a hairpin here folded the strands over each other
  { at: "integrations", x: 0.48, y: -0.25, z: 0 },
  { at: "integrations", x: 0.605, y: 0.54, z: -0.2 },
  { at: "product", x: 0.5, y: 0.12, z: 0.2 },
  { at: "product", x: -0.06, y: 0.5, z: 0.2, pinch: 1 },
  { at: "statement", x: 0.5, y: 0.3, z: -0.5 },
  { at: "scale", x: 0.92, y: 0.9, z: 0.2, pinch: 1 },
  { at: "signals", x: 0.4, y: 0.75, z: -0.4 },
  { at: "proof", x: -0.06, y: 0.6, z: 0.2, pinch: 1 },
  // one broad, symmetric arc through Pricing — the earlier apex sat close
  // under its entry and turned too sharply
  { at: "pricing", x: 0.46, y: -0.1, z: -0.2 },
  { at: "pricing", x: 0.96, y: 0.35, z: 0.1, pinch: 0.8 },
  // the exit: back across Pricing and out through the left edge, above the
  // footer — the stream fades before it reaches the footer's cards
  { at: "pricing", x: 0.48, y: 0.85, z: 0 },
  { at: "pricing", x: -0.49, y: 1.04, z: 0 },
];

export const PATH = {
  1440: [...HERO[1440], ...TAIL],
  1024: [...HERO[1024], ...TAIL],
  768: [...HERO[768], ...TAIL],
  390: [...HERO[390], ...TAIL],
} as const satisfies Record<number, readonly Waypoint[]>;

/** The whole form sits this share of the column right of its waypoints —
    200px at 1440 (client call), scaling with the column elsewhere. */
const SHIFT = 200 / 1440;

/** A resolved waypoint: document CSS px (x from the viewport's left), z, pinch. */
export type PagePoint = { x: number; y: number; z: number; pinch: number };

/** The block a section flows in: itself, or the parent of a sticky layer. */
const blockOf = (el: HTMLElement) => {
  let block = el;
  for (
    let node: HTMLElement | null = el;
    node && node.tagName !== "MAIN";
    node = node.parentElement
  ) {
    if (getComputedStyle(node).position === "sticky" && node.parentElement) {
      block = node.parentElement;
    }
  }
  return block;
};

/** Document top, from layout offsets — immune to scroll-driven transforms. */
const docTop = (el: HTMLElement) => {
  let y = 0;
  for (
    let node: HTMLElement | null = el;
    node;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null
  ) {
    y += node.offsetTop;
  }
  return y;
};

/**
 * Waypoints → document px against the live layout. Points whose section is
 * missing are skipped, so the stream survives a section being removed.
 */
export const resolvePath = (
  waypoints: readonly Waypoint[],
  main: HTMLElement,
): PagePoint[] => {
  const column = main.getBoundingClientRect();
  const points: PagePoint[] = [];
  for (const { at, x, y, z, pinch = 0 } of waypoints) {
    const section = document.getElementById(at);
    if (!section) continue;
    const block = blockOf(section);
    points.push({
      x: column.left + (x + SHIFT) * column.width,
      y: docTop(block) + y * block.offsetHeight,
      z,
      pinch,
    });
  }
  return points;
};
