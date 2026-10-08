"use client";

import { useEffect, useState, type RefObject } from "react";

import { TEXT_MARGIN } from "@/lib/view";

type Mark = () => void;

/**
 * One IntersectionObserver for every `useSeen` element on the page (they all
 * share TEXT_MARGIN), and one scroll listener for the bottom-of-page case —
 * instead of two per element. The page has a few hundred reveals; a few
 * hundred observers each computed their intersection every scrolled frame.
 */
/** Several callers may watch one element (a card's rows all key off the card). */
const marks = new Map<Element, Set<Mark>>();
let observer: IntersectionObserver | null = null;
let scrolling = false;

const atBottom = () => {
  const doc = document.documentElement;
  if (window.scrollY + window.innerHeight < doc.scrollHeight - 4) return;
  const vh = window.innerHeight;
  for (const [el, set] of marks) {
    if (el.getBoundingClientRect().top < vh) set.forEach((mark) => mark());
  }
};

const watch = (el: Element, mark: Mark) => {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting)
            marks.get(entry.target)?.forEach((mark) => mark());
        }
      },
      { rootMargin: TEXT_MARGIN },
    );
  }
  if (!scrolling) {
    window.addEventListener("scroll", atBottom, { passive: true });
    scrolling = true;
  }
  let set = marks.get(el);
  if (!set) {
    set = new Set();
    marks.set(el, set);
    observer.observe(el);
  }
  set.add(mark);
  return () => {
    set.delete(mark);
    if (set.size === 0) {
      marks.delete(el);
      observer?.unobserve(el);
    }
    if (marks.size === 0) {
      observer?.disconnect();
      observer = null;
      window.removeEventListener("scroll", atBottom);
      scrolling = false;
    }
  };
};

/**
 * `true` from the moment `ref` is clearly on screen (see TEXT_MARGIN), and
 * stays true. Anything already on screen when the page opens (the first
 * screen) counts as seen straight away — it would otherwise wait below the
 * TEXT_MARGIN line for a scroll. Elements in the last fifth of the page can
 * never cross that line either, so reaching the bottom of the page also
 * counts as seen for anything already on screen.
 */
export const useSeen = (ref: RefObject<Element | null>) => {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (
      window.scrollY < 4 &&
      el.getBoundingClientRect().top < window.innerHeight
    ) {
      setSeen(true);
      return;
    }
    const unwatch = watch(el, () => setSeen(true));
    atBottom();
    return unwatch;
  }, [ref, seen]);

  return seen;
};
