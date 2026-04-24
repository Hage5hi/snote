import { Heart } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Small inline Ko-fi mark (simplified — cup silhouette with heart inside).
 * Keeps the brand recognizable without pulling a logo asset.
 */
function KofiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M4 6h13a4 4 0 0 1 0 8h-1v1a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6zm13 2v4a2 2 0 1 0 0-4zM9.9 8.6a2 2 0 0 1 2.1.6 2 2 0 0 1 2.1-.6c1 .4 1.4 1.6.8 2.5-.4.7-1.5 1.7-2.9 2.7-1.4-1-2.5-2-2.9-2.7-.6-.9-.2-2.1.8-2.5z" />
    </svg>
  );
}

/**
 * PayPal double-"P" mark, simplified. The real logo has specific kerning we
 * don't need; this reads as PayPal at the icon size we use.
 */
function PaypalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M7.5 3.5h6.2c2.8 0 4.6 1.6 4.1 4.3-.5 2.9-2.7 4.5-5.6 4.5H9.9l-.7 4.4H6.3L7.5 3.5zm2 2.3-.6 4.1h2c1.4 0 2.4-.7 2.6-2 .2-1.4-.6-2.1-2-2.1H9.5zm-4.3 9.4h2.9l-.7 4.6c-.1.5-.5.9-1 .9H4.1l1.1-5.5z" />
      <path d="M18.6 8.3c.4 2.4-1.4 4.2-4.3 4.2h-1.9c-.5 0-.9.3-1 .8l-.8 4.9c-.1.4.2.7.6.7h2.5c.4 0 .8-.3.9-.7l.4-2.1h1.4c2.9 0 5.2-1.5 5.6-4.5.3-1.6-.5-2.9-1.9-3.5a4.7 4.7 0 0 1-1.5.2z" />
    </svg>
  );
}

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
 * Fixed floating support-the-project button. Anchored above `PageIndicator`
 * so the two never collide. Hidden in Zen mode via the shared `zen-hide`
 * class. Purely presentational — no state beyond the DropdownMenu's own.
 */
export function DonateButton() {
  const { pathname } = useLocation();
  if (shouldHide(pathname)) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Support Syrin Notes"
        className="zen-hide fixed bottom-20 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background/80 text-primary shadow-sm backdrop-blur-md transition duration-300 animate-heartbeat motion-reduce:animate-none hover:scale-110 hover:animate-none hover:shadow-lg hover:shadow-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:animate-none"
      >
        <Heart className="h-5 w-5 fill-current" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={10} className="w-56">
        <DropdownMenuItem asChild>
          <a
            href="https://ko-fi.com/sovergarden"
            target="_blank"
            rel="noopener noreferrer"
            className="group cursor-pointer gap-2"
          >
            <KofiIcon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-rose-500" />
            <span className="transition-colors group-hover:text-rose-500">Support on Ko-fi</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href="https://paypal.me/hageshiku"
            target="_blank"
            rel="noopener noreferrer"
            className="group cursor-pointer gap-2"
          >
            <PaypalIcon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-sky-500" />
            <span className="transition-colors group-hover:text-sky-500">Donate via PayPal</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
