// Tests for i18n: dict coverage, navigator/IP detection, storage sync across tabs,
// and component label rendering per language.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import {
  countryToLang,
  detectFromNavigator,
  detectLang,
  dict,
  isLang,
  STORAGE_KEY,
  SUPPORTED_LANGS,
} from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import { useI18n } from "@/i18n";
import { ModeMenu } from "@/components/note/topbar/ModeMenu";

const IP_DETECTED_KEY = "lang.ip_detected";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("i18n dict", () => {
  it("every supported language has all English keys", () => {
    const enKeys = Object.keys(dict.en);
    for (const lang of SUPPORTED_LANGS) {
      if (lang === "en") continue;
      const missing = enKeys.filter((k) => !(k in (dict[lang] as Record<string, string>)));
      expect(missing, `${lang} missing keys`).toEqual([]);
    }
  });

  it("countryToLang maps known countries and ignores unknown / empty", () => {
    expect(countryToLang("VN")).toBe("vi");
    expect(countryToLang("cn")).toBe("zh");
    expect(countryToLang("FR")).toBe("fr");
    expect(countryToLang("US")).toBeNull();
    expect(countryToLang("")).toBeNull();
    expect(countryToLang(undefined)).toBeNull();
    expect(countryToLang(null)).toBeNull();
  });

  it("isLang validates only supported codes", () => {
    expect(isLang("vi")).toBe(true);
    expect(isLang("en")).toBe(true);
    expect(isLang("xx")).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it("detectFromNavigator falls back to en when no match", () => {
    vi.stubGlobal("navigator", { language: "de-DE", languages: ["de-DE"] });
    expect(detectFromNavigator()).toBe("en");
    vi.stubGlobal("navigator", { language: "ja-JP", languages: ["ja-JP", "en"] });
    expect(detectFromNavigator()).toBe("ja");
    vi.unstubAllGlobals();
  });

  it("detectLang prefers saved value over navigator", () => {
    localStorage.setItem(STORAGE_KEY, "ko");
    expect(detectLang()).toBe("ko");
    localStorage.setItem(STORAGE_KEY, "bogus");
    // Invalid saved value → navigator fallback (en in jsdom).
    expect(detectLang()).toBe("en");
  });
});

function Probe() {
  const { lang, t } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="zen">{t("mode.zen.enter")}</span>
    </div>
  );
}

describe("I18nProvider — IP detection & storage sync", () => {
  it("falls back to navigator language when IP fetch times out / errors", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {})); // never resolves
    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    // Initial render uses navigator (en in jsdom).
    expect(screen.getByTestId("lang").textContent).toBe("en");
    // Advance past the 2.5s AbortController timeout — should not throw.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not crash when ipapi returns no country_code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("lang").textContent).toBe("en");
    vi.unstubAllGlobals();
  });

  it("skips IP fetch when user already saved a language", () => {
    localStorage.setItem(STORAGE_KEY, "fr");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("fr");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("syncs language across tabs via storage event", async () => {
    localStorage.setItem(IP_DETECTED_KEY, "1"); // skip IP fetch
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: "vi",
        }),
      );
    });
    expect(screen.getByTestId("lang").textContent).toBe("vi");
    expect(screen.getByTestId("zen").textContent).toBe(dict.vi["mode.zen.enter"]);

    // Invalid storage values are ignored.
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEY, newValue: "xx" }),
      );
    });
    expect(screen.getByTestId("lang").textContent).toBe("vi");
  });
});

describe("ModeMenu — labels follow current language", () => {
  function setup(lang: string) {
    localStorage.setItem(STORAGE_KEY, lang);
    localStorage.setItem(IP_DETECTED_KEY, "1");
    return render(
      <I18nProvider>
        <ModeMenu
          zen={false}
          onToggleZen={() => {}}
          typewriter={false}
          onToggleTypewriter={() => {}}
          focusLine={false}
          onToggleFocusLine={() => {}}
          paginated={false}
          onTogglePagination={() => {}}
        />
      </I18nProvider>,
    );
  }

  it("renders Vietnamese trigger + shortcut hints", () => {
    setup("vi");
    expect(screen.getByRole("button", { name: /Chế độ/ })).toBeInTheDocument();
  });

  it("renders Japanese trigger", () => {
    setup("ja");
    expect(screen.getByRole("button", { name: /モード/ })).toBeInTheDocument();
  });

  it("renders English trigger by default", () => {
    setup("en");
    expect(screen.getByRole("button", { name: /^Mode/ })).toBeInTheDocument();
    // Mode shortcut hints are hardcoded in JSX → language-independent contract.
    expect(dict.en["mode.zen.desc"]).toBeTruthy();
    expect(dict.vi["mode.zen.desc"]).not.toBe(dict.en["mode.zen.desc"]);
  });

});
