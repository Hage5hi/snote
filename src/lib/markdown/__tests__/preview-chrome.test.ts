import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePreviewChromeClick, labelPreviewChrome, previewNoteSlugFromHref } from "../preview-chrome";

describe("preview chrome", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("labels copy and heading controls", () => {
    document.body.innerHTML = `
      <div id="host">
        <h2 id="preview-h-owner" class="md-heading">
          <button type="button" class="md-heading-anchor" data-preview-heading="preview-h-owner"></button>
          Owner
        </h2>
        <pre class="md-code-block"><button type="button" class="md-code-copy" data-md-copy></button><code>hi</code></pre>
      </div>
    `;
    const host = document.getElementById("host")!;
    labelPreviewChrome(host, "Copy", "Jump to heading");
    expect(host.querySelector("[data-md-copy]")).toHaveTextContent("Copy");
    expect(host.querySelector("[data-preview-heading]")).toHaveAttribute("aria-label", "Jump to heading");
  });

  it("copies fenced code without a network call", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    document.body.innerHTML = `
      <div id="host">
        <pre class="md-code-block"><button type="button" class="md-code-copy" data-md-copy>Copy</button><code>hello</code></pre>
      </div>
    `;
    const host = document.getElementById("host")!;
    const button = host.querySelector("[data-md-copy]") as HTMLButtonElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: button });
    await handlePreviewChromeClick(event, host, { copy: "Copy", copied: "Copied" });
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(button).toHaveTextContent("Copied");
  });

  it("scrolls to a heading inside the preview without rewriting location.hash", async () => {
    const originalHash = window.location.hash;
    document.body.innerHTML = `
      <div id="host" style="height:40px;overflow:auto">
        <h2 id="preview-h-owner" class="md-heading">
          <button type="button" class="md-heading-anchor" data-preview-heading="preview-h-owner">#</button>
          Owner
        </h2>
      </div>
    `;
    const host = document.getElementById("host")!;
    const heading = host.querySelector("#preview-h-owner") as HTMLElement;
    heading.scrollIntoView = vi.fn();
    const button = host.querySelector("[data-preview-heading]") as HTMLButtonElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: button });
    await handlePreviewChromeClick(event, host, { copy: "Copy", copied: "Copied" });
    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe(originalHash);
  });

  it("maps expanded wiki hrefs to note slugs", () => {
    expect(previewNoteSlugFromHref("/hop-team", "https://note.syrin.online")).toBe("hop-team");
    expect(previewNoteSlugFromHref("/hello%20world", "https://note.syrin.online")).toBe("hello world");
    expect(previewNoteSlugFromHref("https://example.com/x", "https://note.syrin.online")).toBeNull();
    expect(previewNoteSlugFromHref("/foo.md", "https://note.syrin.online")).toBeNull();
  });

  it("dispatches in-app wiki navigation for same-origin preview links", async () => {
    const seen: string[] = [];
    const onNav = (event: Event) => {
      seen.push((event as CustomEvent<{ slug: string }>).detail.slug);
    };
    window.addEventListener("snotes:wiki-nav", onNav);
    document.body.innerHTML = `
      <div id="host">
        <p><a href="/hop-team">Họp team</a></p>
      </div>
    `;
    const host = document.getElementById("host")!;
    const link = host.querySelector("a") as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: link });
    await handlePreviewChromeClick(event, host, { copy: "Copy", copied: "Copied" });
    window.removeEventListener("snotes:wiki-nav", onNav);
    expect(event.defaultPrevented).toBe(true);
    expect(seen).toEqual(["hop-team"]);
  });
});
