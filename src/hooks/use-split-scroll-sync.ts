import { useCallback, useEffect, useRef, useState } from "react";

export type SplitScrollerRegistration = (index: number, element: HTMLElement | null) => void;

/**
 * Synchronize split-pane scrollers by scroll ratio.
 *
 * Panes are lazy and encryption-gated, so their scroll elements can appear
 * well after SplitView mounts. Registration is explicit and re-wires the
 * listeners whenever a pane replaces or removes its primary scroller.
 */
export function useSplitScrollSync(
  enabled: boolean,
  paneCount: number,
): SplitScrollerRegistration {
  const scrollersRef = useRef<Array<HTMLElement | null>>([]);
  const [registrationVersion, setRegistrationVersion] = useState(0);

  const registerScroller = useCallback<SplitScrollerRegistration>((index, element) => {
    if (scrollersRef.current[index] === element) return;
    scrollersRef.current[index] = element;
    setRegistrationVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const scrollers = scrollersRef.current
      .slice(0, paneCount)
      .filter((element): element is HTMLElement => element !== null);
    if (scrollers.length < 2) return;

    let locked = false;
    const listeners = scrollers.map((source) => {
      const onScroll = () => {
        if (locked) return;
        const sourceRange = Math.max(1, source.scrollHeight - source.clientHeight);
        const ratio = source.scrollTop / sourceRange;
        locked = true;
        for (const destination of scrollers) {
          if (destination === source) continue;
          const destinationRange = Math.max(
            1,
            destination.scrollHeight - destination.clientHeight,
          );
          destination.scrollTop = ratio * destinationRange;
        }
        requestAnimationFrame(() => {
          locked = false;
        });
      };
      source.addEventListener("scroll", onScroll, { passive: true });
      return [source, onScroll] as const;
    });

    return () => {
      for (const [source, onScroll] of listeners) {
        source.removeEventListener("scroll", onScroll);
      }
    };
  }, [enabled, paneCount, registrationVersion]);

  return registerScroller;
}
