import { useScroll } from "@/hooks/smooth-scroll/use-scroll";

/**
 * The page's scroll position for per-frame code, without touching layout.
 *
 * `window.scrollY` is a layout-dependent read: asked for inside a frame
 * callback that runs after the springs have written their styles, it forces
 * a style flush every frame. Lenis already holds the position as a plain
 * number — the value it just applied (smooth wheel), or the one it read in
 * the scroll event on a touch device (free there: layout is clean). Before
 * Lenis is up, fall back to the window.
 */
export const readScrollY = (): number => {
  const lenis = useScroll.getState().lenis;
  return lenis ? lenis.scroll : window.scrollY;
};
