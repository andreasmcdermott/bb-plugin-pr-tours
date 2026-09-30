import { TourRootContext } from "./runtime.tsx";
import { useCallback, useContext, useEffect, useState } from "react";

const READING_LINE = 80;

export function currentTarget(
  targets: { id: string; top: number }[],
  viewport: { line: number; atBottom: boolean },
): string | null {
  if (viewport.atBottom) return targets.at(-1)?.id ?? null;
  const reached = targets.filter((target) => target.top <= viewport.line);
  return (reached.at(-1) ?? targets[0])?.id ?? null;
}

// Follows the scroll position, except that a target the reader jumped to stays
// current until they scroll themselves: a short section near the end can't
// reach the reading line, so scrolling alone would never select it.
export function useReadingPosition(ids: string[]): [string | null, (id: string) => void] {
  const rootRef = useContext(TourRootContext);
  const [scrolled, setScrolled] = useState<string | null>(null);
  const [jumped, setJumped] = useState<string | null>(null);
  const key = ids.join("\n");

  useEffect(() => {
    const root = rootRef?.current;
    if (!root) return;
    const targetIds = key.split("\n");
    let frame = 0;
    const measure = () => {
      frame = 0;
      const targets = targetIds.flatMap((id) => {
        const element = root.querySelector(`[id="${CSS.escape(id)}"]`);
        return element
          ? [{ id, top: element.getBoundingClientRect().top - root.getBoundingClientRect().top }]
          : [];
      });
      const { scrollHeight } = root;
      const atBottom = root.scrollTop > 0 && root.clientHeight + root.scrollTop >= scrollHeight - 1;
      setScrolled(currentTarget(targets, { line: READING_LINE, atBottom }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const release = () => setJumped(null);
    const followHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (targetIds.includes(id)) setJumped(id);
    };
    const followJump = (event: Event) => setJumped((event as CustomEvent<string>).detail);
    root.addEventListener("tour-jump", followJump);
    followHash();
    measure();
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", followHash);
    for (const type of ["wheel", "touchstart", "keydown"]) {
      window.addEventListener(type, release, { passive: true });
    }
    return () => {
      root.removeEventListener("tour-jump", followJump);
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", followHash);
      for (const type of ["wheel", "touchstart", "keydown"]) {
        window.removeEventListener(type, release);
      }
    };
  }, [key, rootRef]);

  const jump = useCallback((id: string) => setJumped(id), []);
  return [jumped ?? scrolled, jump];
}
