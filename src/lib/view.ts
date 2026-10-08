/**
 * When on-scroll LOOPS and illustrations start: once the element's top has
 * come ~12% up from the bottom of the viewport — so the motion plays from its
 * first frame where you are looking, not while the block is still near the
 * bottom edge.
 */
export const VIEW_MARGIN = "0px 0px -12% 0px";

/**
 * When TEXT and card entrances start (`useSeen` / `InviewSeen`): a little
 * before the element reaches the viewport (5% below the fold), so the motion
 * is already under way as it scrolls in — it never waits on screen.
 */
export const TEXT_MARGIN = "0px 0px 5% 0px";
