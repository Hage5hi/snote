import { test, expect } from "./fixtures/extension";

const APP_ORIGIN = "https://note.syrin.online";

test("fallback stays honest without privileged diagnostic probes", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  const diagnosticProbeUrls: string[] = [];
  panel.on("request", (request) => {
    if (request.url().includes("/version.json")) {
      diagnosticProbeUrls.push(request.url());
    }
  });

  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await panel.evaluate((origin) => {
    const ev = new MessageEvent("message", {
      data: { type: "syrin:ready", protocol: 999, buildId: "bad" },
      source: (document.getElementById("app") as HTMLIFrameElement).contentWindow,
    });
    Object.defineProperty(ev, "origin", { value: origin });
    window.dispatchEvent(ev);
  }, APP_ORIGIN);

  await expect(panel.locator("#fallback-reason")).toHaveText(
    "Handshake protocol mismatch: app protocol=999 not in [1,2] (ext=2)",
  );
  await expect(panel.locator("#diag-head")).toHaveText("online-unverified");
  expect(diagnosticProbeUrls).toEqual([]);
});
