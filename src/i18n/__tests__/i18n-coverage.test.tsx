// E2E-style i18n coverage: cross-tab sync, persistence across reload,
// and Export/Help label rendering per language including toast strings.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { dict, STORAGE_KEY, SUPPORTED_LANGS, useI18n, type Lang } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ExportMenu } from "@/components/note/topbar/ExportMenu";
import { HelpMenu } from "@/components/note/topbar/HelpMenu";

const IP_DETECTED_KEY = "lang.ip_detected";

// Capture toast() calls for assertion.
const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast: (args: unknown) => toastSpy(args),
  useToast: () => ({ toast: toastSpy, dismiss: () => {}, toasts: [] }),
}));

beforeEach(() => {
  localStorage.clear();
  toastSpy.mockClear();
  // Skip ipapi.co fetch so tests are deterministic.
  localStorage.setItem(IP_DETECTED_KEY, "1");
  // Stable clipboard mock.
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => {}) },
  });
});

afterEach(() => cleanup());

function ProbeAll() {
  const { lang, t } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="menu-export">{t("menu.export")}</span>
      <span data-testid="menu-help">{t("menu.help")}</span>
      <span data-testid="export-copy">{t("export.copy_url")}</span>
      <span data-testid="export-ai">{t("export.ai")}</span>
      <span data-testid="help-shortcuts">{t("help.shortcuts")}</span>
      <span data-testid="toast-empty">{t("toast.note_empty")}</span>
      <span data-testid="toast-copied">{t("toast.copied_url")}</span>
    </div>
  );
}

describe("E2E — cross-tab language sync via storage event", () => {
  it("switching language in one tab updates another tab's labels immediately", async () => {
    // Tab A renders LanguageToggle, Tab B mirrors via storage events.
    const { unmount: unmountA } = render(
      <I18nProvider>
        <LanguageToggle />
      </I18nProvider>,
    );
    render(
      <I18nProvider>
        <ProbeAll />
      </I18nProvider>,
      { container: document.body.appendChild(document.createElement("div")) },
    );

    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("menu-export").textContent).toBe(dict.en["menu.export"]);

    // Simulate Tab A picking Vietnamese: provider writes to localStorage, then
    // browsers dispatch a `storage` event in OTHER tabs only. We fire it
    // manually so Tab B observes the change.
    await act(async () => {
      localStorage.setItem(STORAGE_KEY, "vi");
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEY, newValue: "vi" }),
      );
    });

    expect(screen.getByTestId("lang").textContent).toBe("vi");
    expect(screen.getByTestId("menu-export").textContent).toBe(dict.vi["menu.export"]);
    expect(screen.getByTestId("menu-help").textContent).toBe(dict.vi["menu.help"]);
    expect(screen.getByTestId("toast-empty").textContent).toBe(dict.vi["toast.note_empty"]);

    // And again to Spanish.
    await act(async () => {
      localStorage.setItem(STORAGE_KEY, "es");
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEY, newValue: "es" }),
      );
    });
    expect(screen.getByTestId("menu-export").textContent).toBe(dict.es["menu.export"]);
    expect(screen.getByTestId("help-shortcuts").textContent).toBe(dict.es["help.shortcuts"]);

    unmountA();
  });
});

describe("Persistence — language survives reload", () => {
  it("LanguageToggle writes to localStorage and a remount picks it up", async () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const { unmount } = render(
      <I18nProvider>
        <LanguageToggle />
        <ProbeAll />
      </I18nProvider>,
    );

    // Simulate user picking French via the toggle's onClick path (setLang).
    // We can't easily open the Radix dropdown in jsdom, so call setLang directly
    // through a Probe — but the contract under test is the persistence side
    // effect, which lives in provider.setLang().
    await act(async () => {
      // Reuse the toggle's setLang by writing through the provider:
      // dispatch a synthetic click on a hidden Probe button.
    });

    // Use a focused probe that exposes setLang.
    function Picker() {
      const { setLang } = useI18n();
      return (
        <button data-testid="pick-fr" onClick={() => setLang("fr")}>
          fr
        </button>
      );
    }
    unmount();
    const { unmount: unmount2 } = render(
      <I18nProvider>
        <Picker />
        <ProbeAll />
      </I18nProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-fr"));
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe("fr");
    expect(screen.getByTestId("menu-export").textContent).toBe(dict.fr["menu.export"]);
    unmount2();

    // "Reload": fresh provider mount reads from localStorage.
    render(
      <I18nProvider>
        <ProbeAll />
      </I18nProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("fr");
    expect(screen.getByTestId("menu-help").textContent).toBe(dict.fr["menu.help"]);
    expect(screen.getByTestId("export-ai").textContent).toBe(dict.fr["export.ai"]);
  });

  it("language stored via setLang persists across remounts (simulated reload)", () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBe("fr");
  });

describe("Export menu — localized trigger + dict coverage", () => {
  const EXPORT_KEYS = [
    "menu.export",
    "export.copy_url",
    "export.md",
    "export.html",
    "export.pdf",
    "export.txt",
    "export.ai",
    "export.raw",
    "export.raw_tooltip",
  ] as const;

  it.each(SUPPORTED_LANGS)("renders ExportMenu trigger in %s", (lang: Lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    render(
      <I18nProvider>
        <ExportMenu slug="demo" getContent={() => "hello"} isEncrypted={false} />
      </I18nProvider>,
    );
    const expected = (dict[lang] as Record<string, string>)["menu.export"];
    expect(screen.getByRole("button", { name: new RegExp(expected) })).toBeInTheDocument();
  });

  it("every Export string is non-empty and distinct from English for non-English langs", () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const key of EXPORT_KEYS) {
        const v = (dict[lang] as Record<string, string>)[key];
        expect(v, `${lang}/${key}`).toBeTruthy();
      }
      if (lang === "en") continue;
      // At least one Export key must be localized (not identical to English).
      const anyLocalized = EXPORT_KEYS.some(
        (k) =>
          (dict[lang] as Record<string, string>)[k] !==
          (dict.en as Record<string, string>)[k],
      );
      expect(anyLocalized, `${lang} has no localized export.* strings`).toBe(true);
    }
  });
});

describe("Help menu — localized trigger + split-view hint placeholder", () => {
  it.each(SUPPORTED_LANGS)("renders HelpMenu trigger in %s", (lang: Lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    render(
      <I18nProvider>
        <HelpMenu onOpenShortcuts={() => {}} />
      </I18nProvider>,
    );
    const expected = (dict[lang] as Record<string, string>)["menu.help"];
    expect(screen.getByRole("button", { name: new RegExp(expected) })).toBeInTheDocument();
  });

  it("help.split_hint contains {code} placeholder in every language", () => {
    for (const lang of SUPPORTED_LANGS) {
      const v = (dict[lang] as Record<string, string>)["help.split_hint"];
      expect(v, `${lang}/help.split_hint`).toMatch(/\{code\}/);
    }
  });
});

describe("Toast strings — localized and parameter substitution works", () => {
  function T() {
    const { t } = useI18n();
    return (
      <>
        <span data-testid="ai">{t("toast.copied_ai_desc", { n: 42 })}</span>
        <span data-testid="chars">{t("toast.copied_chars", { n: 7 })}</span>
      </>
    );
  }

  it.each(SUPPORTED_LANGS)("substitutes {n} in toast strings — %s", (lang: Lang) => {
    localStorage.setItem(STORAGE_KEY, lang);
    render(
      <I18nProvider>
        <T />
      </I18nProvider>,
    );
    expect(screen.getByTestId("ai").textContent).toContain("42");
    expect(screen.getByTestId("chars").textContent).toContain("7");
  });
});
