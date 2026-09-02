/**
 * Preview-only DOM chrome: copy buttons and in-pane heading jumps.
 * Click handlers must not write location.hash (capability/encryption fragments).
 */
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

  const anchor = target.closest("[data-preview-heading]");
  if (!(anchor instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const id = anchor.getAttribute("data-preview-heading");
  if (!id) return;
  const heading = host.querySelector(`#${CSS.escape(id)}`);
  heading?.scrollIntoView({ block: "start", behavior: "smooth" });
}
