/**
 * Preview-only DOM chrome: copy buttons, in-pane heading jumps, and in-app
 * wiki-link navigation. Click handlers must not write location.hash
 * (capability/encryption fragments).
 */
import { WIKI_NAV_EVENT } from "@/lib/wiki-link";
import { isUsableSlug } from "@/lib/slug";
export function labelPreviewChrome(
  host: HTMLElement,
  copyLabel: string,
  headingLabel: string,
): void {
  for (const btn of host.querySelectorAll<HTMLButtonElement>("[data-md-copy]")) {
    if (btn.dataset.copied === "true") continue;
    btn.textContent = copyLabel;
    btn.setAttribute("aria-label", copyLabel);
  }
  for (const btn of host.querySelectorAll("[data-preview-heading]")) {
    btn.setAttribute("aria-label", headingLabel);
  }
}

export async function handlePreviewChromeClick(
  event: MouseEvent,
  host: HTMLElement,
  labels: { copy: string; copied: string },
): Promise<void> {
  const target = event.target;
  if (!(target instanceof Element) || !host.contains(target)) return;

  const copyBtn = target.closest("[data-md-copy]");
  if (copyBtn instanceof HTMLButtonElement) {
    event.preventDefault();
    const pre = copyBtn.closest("pre");
    const code = pre?.querySelector("code");
    const text = code?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.dataset.copied = "true";
      copyBtn.textContent = labels.copied;
      copyBtn.setAttribute("aria-label", labels.copied);
      window.setTimeout(() => {
        if (!copyBtn.isConnected) return;
        copyBtn.dataset.copied = "false";
        copyBtn.textContent = labels.copy;
        copyBtn.setAttribute("aria-label", labels.copy);
      }, 1500);
    } catch {
      /* clipboard can be denied; leave the button as-is */
    }
    return;
  }

  const headingBtn = target.closest("[data-preview-heading]");
  if (headingBtn instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const id = headingBtn.getAttribute("data-preview-heading");
    if (!id) return;
    const heading = host.querySelector(`#${CSS.escape(id)}`);
    heading?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }

  navigatePreviewNoteLink(event, host);
}

/** Same-origin `/slug` preview links (from `[[slug]]` / `[[slug|display]]`) stay in-app. */
export function previewNoteSlugFromHref(href: string, origin = window.location.origin): string | null {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.search) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  if (/\.md$/i.test(parts[0])) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(parts[0]);
  } catch {
    slug = parts[0];
  }
  if (!isUsableSlug(slug)) return null;
  return slug;
}

function navigatePreviewNoteLink(event: MouseEvent, host: HTMLElement): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || !host.contains(anchor)) return;
  const slug = previewNoteSlugFromHref(anchor.getAttribute("href") ?? "");
  if (!slug) return;
  event.preventDefault();
  window.dispatchEvent(new CustomEvent(WIKI_NAV_EVENT, { detail: { slug } }));
}
