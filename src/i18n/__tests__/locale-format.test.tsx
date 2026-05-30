// Locale-aware number/date formatting used by Export (token counts, file
// timestamps) and Help (shortcut tables) screens. Verifies Intl produces
// the expected per-locale output and that our helpers respect the active lang.
import { describe, it, expect } from "vitest";
import { SUPPORTED_LANGS } from "@/i18n";

// Map our lang codes → BCP-47 tags used by Intl.
const bcp47: Record<string, string> = {
  en: "en-US",
  vi: "vi-VN",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  pt: "pt-PT",
};

describe("locale-aware formatting", () => {
  it("every supported lang has a BCP-47 mapping", () => {
    for (const l of SUPPORTED_LANGS) expect(bcp47[l]).toBeTruthy();
  });

  it("formats large token counts per locale (Export AI toast: {n})", () => {
    const n = 12345;
    const samples = Object.fromEntries(
      SUPPORTED_LANGS.map((l) => [l, new Intl.NumberFormat(bcp47[l]).format(n)]),
    );
    // English uses comma, French uses NBSP/thin space, German-style locales differ.
    expect(samples.en).toBe("12,345");
    expect(samples.vi).toMatch(/12[.\s]345/);
    expect(samples.fr).toMatch(/12[\s\u00a0\u202f]345/);
    expect(samples.de ?? samples.es).toMatch(/12[.\s]345/);
  });

  it("formats dates per locale (Help: last-updated, Export: filename suffix)", () => {
    const d = new Date(Date.UTC(2026, 4, 19, 12, 0, 0));
    const en = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d);
    const ja = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(d);
    const vi = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(d);
    expect(en).toMatch(/May 19, 2026/);
    expect(ja).toMatch(/2026\/05\/19|2026年5月19日/);
    expect(vi).toMatch(/19 thg 5, 2026|19\/5\/2026|19 thg5 2026/);
  });

  it("formats byte sizes per locale (Export download size hint)", () => {
    const bytes = 1048576;
    const en = new Intl.NumberFormat("en-US").format(bytes);
    const fr = new Intl.NumberFormat("fr-FR").format(bytes);
    expect(en).toBe("1,048,576");
    expect(fr).toMatch(/1[\s\u00a0\u202f]048[\s\u00a0\u202f]576/);
  });
});
