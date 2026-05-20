// U6 — CSS-only confetti burst that fires once when the user crosses their
// word-count goal. No JS animation lib, no SVG — 12 absolutely-positioned
// divs animated by the `.animate-goal-confetti` keyframes in index.css.
//
// Renders nothing when motion is disabled (e-ink mode pins
// `animation: none !important` globally, and the keyframes are gated by
// `prefers-reduced-motion: no-preference`).
import { useEffect, useMemo, useState } from "react";

interface GoalConfettiProps {
  /** Bumped each time a celebration should fire. */
  trigger: number;
}

interface Dot {
  id: number;
  x: number;
  rot: number;
  delay: number;
  color: string;
  size: number;
}

const PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--info))",
  "hsl(var(--warning))",
];

function makeDots(seed: number): Dot[] {
  const dots: Dot[] = [];
  // Simple deterministic-ish seeded jitter so React's StrictMode double-mount
  // doesn't render two different bursts.
  let s = seed * 2654435761;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < 12; i++) {
    dots.push({
      id: i,
      x: (rand() - 0.5) * 160,
      rot: (rand() - 0.5) * 540,
      delay: rand() * 80,
      color: PALETTE[i % PALETTE.length],
      size: 5 + Math.floor(rand() * 4),
    });
  }
  return dots;
}

export function GoalConfetti({ trigger }: GoalConfettiProps) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (trigger <= 0) return;
    setActive(trigger);
    const timer = window.setTimeout(() => setActive(0), 1600);
    return () => window.clearTimeout(timer);
  }, [trigger]);
  const dots = useMemo(() => (active ? makeDots(active) : []), [active]);
  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-1/2 top-16 z-[60] -translate-x-1/2"
    >
      {dots.map((d) => (
        <span
          key={d.id}
          className="absolute block rounded-full motion-safe:animate-goal-confetti"
          style={{
            width: `${d.size}px`,
            height: `${d.size}px`,
            background: d.color,
            // Custom property consumed by the keyframes for translateX/rotate.
            ["--cf-x" as string]: `${d.x}px`,
            ["--cf-r" as string]: `${d.rot}deg`,
            animationDelay: `${d.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}
