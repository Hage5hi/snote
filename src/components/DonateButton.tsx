import { Heart } from "lucide-react";
import { useLocation } from "react-router-dom";

/**
 * Routes where the floating donate button is intentionally suppressed:
 *  - `/note` — admin panel (ops context, no place for a tip jar).
 *  - `*.md`  — raw plaintext view served for wget/curl/etc.
 */
function shouldHide(pathname: string) {
  if (pathname === "/note") return true;
  if (/\.md$/i.test(pathname)) return true;
  return false;
}

/**
 * Fixed floating support-the-project button. Single-click opens Ko-fi in a new
 * tab — no dropdown, no PayPal fallback. Anchored above `PageIndicator` so the
 * two never collide. Hidden in Zen mode via the shared `zen-hide` class.
 */
export function DonateButton() {
  const { pathname } = useLocation();
  if (shouldHide(pathname)) return null;

  return (
    <a
      href="https://ko-fi.com/sovergarden"
      target="_blank"
      rel="noopener noreferrer"
      // eslint-disable-next-line no-restricted-syntax -- brand label
      aria-label="Support Syrin Notes on Ko-fi"
      className="zen-hide fixed bottom-20 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/80 text-primary shadow-sm backdrop-blur-md transition duration-300 animate-heartbeat motion-reduce:animate-none hover:scale-110 hover:animate-none hover:shadow-lg hover:shadow-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Heart className="h-5 w-5 fill-current" />
    </a>
  );
}
