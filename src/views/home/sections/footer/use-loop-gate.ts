"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Gate for the footer's ambient loops: `inView` follows an
 * IntersectionObserver on the returned ref, `reduced` mirrors
 * `prefers-reduced-motion`. Loops run only while `inView && !reduced`.
 */
export const useLoopGate = <T extends Element>() => {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return { ref, inView, reduced };
};
