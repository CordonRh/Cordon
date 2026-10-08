/**
 * The logo fold shared by 05 Statement (LogoOpen) and the home preloader:
 * a plate opening out of / folding into the Relay logo tile.
 */

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Logo tile corner as a share of its side (24 / 76). */
export const TILE_ROUND = 24 / 76;

/**
 * The plate's clip at `g` (0 = folded, 1 = open), in two stages so it always
 * folds INTO the logo tile, square-first:
 *  - g 1 → 0.5: the plate narrows into the largest square centred on the
 *    logo that fits inside it, its corners rounding up like the tile's;
 *  - g 0.5 → 0: that square shrinks onto the logo tile itself.
 * Opening plays the same path backwards. At g 0 nothing shows.
 */
export type FoldBox = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  round: number;
};

/**
 * The same geometry as numbers. `curve` eases each stage; the preloader
 * passes a linear one because its spring already eases, and a per-stage ease
 * would stall the motion at the square.
 */
export const foldBox = (
  g: number,
  w: number,
  h: number,
  cx: number,
  cy: number,
  tile: number,
  plateRound: number,
  curve: (t: number) => number = smooth,
): FoldBox => {
  /* the square stays whole inside the plate (which slides up as it folds),
     so it is never cut by the plate's edge — at least the tile's size */
  const side0 = Math.max(tile, 2 * Math.min(cx, w - cx, cy, h - cy));
  if (g < 0.5) {
    const t = curve(Math.max(g, 0) / 0.5);
    const half = (tile + (side0 - tile) * t) / 2;
    return {
      top: cy - half,
      left: cx - half,
      bottom: h - (cy + half),
      right: w - (cx + half),
      round: half * 2 * TILE_ROUND,
    };
  }
  const t = curve(Math.min(g, 1) * 2 - 1);
  const half = side0 / 2;
  return {
    top: (cy - half) * (1 - t),
    right: (w - (cx + half)) * (1 - t),
    bottom: (h - (cy + half)) * (1 - t),
    left: (cx - half) * (1 - t),
    round: side0 * TILE_ROUND * (1 - t) + plateRound * t,
  };
};

export const fold = (
  g: number,
  w: number,
  h: number,
  cx: number,
  cy: number,
  tile: number,
  plateRound: number,
  curve?: (t: number) => number,
) => {
  if (g <= 0) return "inset(50%)";
  const { top, right, bottom, left, round } = foldBox(
    g,
    w,
    h,
    cx,
    cy,
    tile,
    plateRound,
    curve,
  );
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${round}px)`;
};
