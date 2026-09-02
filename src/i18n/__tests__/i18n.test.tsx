// Tests for i18n: dict coverage, browser-locale detection, storage sync across tabs,
// and component label rendering per language.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  detectFromNavigator,
  detectLang,
  isLang,
  loadDictionary,
  STORAGE_KEY,
  SUPPORTED_LANGS,
} from "@/i18n";
import { dict } from "@/i18n/catalog";
import { I18nProvider } from "@/i18n/provider";
import { useI18n } from "@/i18n";
import { ModeMenu } from "@/components/note/topbar/ModeMenu";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // Pin navigator language so tests don't depend on the host machine's locale
  // (e.g. CI defaulting to de-DE would now match our supported "de").
  vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("i18n dict", () => {
  it("every supported language has all English keys", () => {
    const enKeys = Object.keys(dict.en);
    for (const lang of SUPPORTED_LANGS) {
      if (lang === "en") continue;
      const localeKeys = Object.keys(dict[lang] as Record<string, string>);
      const missing = enKeys.filter((k) => !(k in (dict[lang] as Record<string, string>)));
      const extra = localeKeys.filter((k) => !(k in dict.en));
      expect(missing, `${lang} missing keys`).toEqual([]);
      expect(extra, `${lang} extra keys`).toEqual([]);
    }
  });

  it("knowledge panel copy is present and Vietnamese is not a copy of English", () => {
    const keys = [
      "knowledge.backlinks",
      "knowledge.backlinks_empty",
      "knowledge.dead_count",
      "knowledge.orphan_hint",
      "knowledge.open_note",
    ] as const;
    for (const key of keys) {
      expect(dict.en[key]).toBeTruthy();
      expect(dict.vi[key]).toBeTruthy();
      expect(dict.vi[key]).not.toBe(dict.en[key]);
    }
    expect(dict.en["knowledge.dead_count"]).toContain("{n}");
    expect(dict.vi["knowledge.dead_count"]).toContain("{n}");
    expect(dict.en["knowledge.open_note"]).toContain("{slug}");
    expect(dict.vi["knowledge.open_note"]).toContain("{slug}");
    expect(dict.vi["knowledge.backlinks_empty"]).toMatch(/trỏ tới đây/i);
  });

  it("history burst and hunk restore copy exists in every locale", () => {
    const keys = [
      "history.burst.heading",
      "history.burst.n_snapshots",
      "history.burst.compare",
      "history.hunk.restore",
      "history.hunk.restore_n",
      "history.confirm_restore_hunks",
      "history.toast_hunks_restored",
    ] as const;
    for (const lang of SUPPORTED_LANGS) {
      for (const key of keys) {
        expect(dict[lang][key], `${lang}:${key}`).toBeTruthy();
      }
      expect(dict[lang]["history.burst.n_snapshots"]).toContain("{n}");
      expect(dict[lang]["history.hunk.restore_n"]).toContain("{n}");
      expect(dict[lang]["history.confirm_restore_hunks"]).toContain("{n}");
    }
    expect(dict.en["history.confirm_restore_hunks"]).toMatch(/every open device/i);
    expect(dict.en["history.confirm_restore_hunks"]).toMatch(/slug/i);
    expect(dict.vi["history.confirm_restore_hunks"]).not.toBe(dict.en["history.confirm_restore_hunks"]);
    expect(dict.vi["history.burst.compare"]).not.toBe(dict.en["history.burst.compare"]);
  });

  it("preview alert and slash-command details are translated", () => {
    const keys = [
      "preview.alert.note",
      "preview.alert.tip",
      "preview.alert.important",
      "preview.alert.warning",
      "preview.alert.caution",
      "slash.detail.mermaid",
      "slash.detail.math",
      "slash.detail.note",
      "slash.detail.tip",
      "slash.detail.important",
      "slash.detail.warning",
      "slash.detail.caution",
    ] as const;
    for (const key of keys) {
      expect(dict.en[key]).toBeTruthy();
      expect(dict.vi[key]).toBeTruthy();
      expect(dict.vi[key]).not.toBe(dict.en[key]);
    }
  });

  it("command palette search copy is present and Vietnamese is not a copy of English", () => {
    const keys = [
      "cmdk.placeholder",
      "cmdk.indexing",
      "cmdk.empty",
      "cmdk.empty_tag",
      "cmdk.empty_tag_hint",
      "cmdk.group_notes",
      "cmdk.group_tag",
      "tag.open_filter",
    ] as const;
    for (const key of keys) {
      expect(dict.en[key]).toBeTruthy();
      expect(dict.vi[key]).toBeTruthy();
      expect(dict.vi[key]).not.toBe(dict.en[key]);
    }
    expect(dict.en["cmdk.placeholder"]).toMatch(/#tag/);
    expect(dict.vi["cmdk.placeholder"]).toMatch(/#tag/);
    expect(dict.en["cmdk.empty_tag"]).toContain("{tag}");
    expect(dict.vi["cmdk.empty_tag"]).toContain("{tag}");
    expect(dict.en["cmdk.group_tag"]).toContain("{tag}");
    expect(dict.vi["cmdk.group_tag"]).toContain("{tag}");
    expect(dict.vi["cmdk.indexing"]).toMatch(/chỉ mục/i);
    expect(dict.en["tag.open_filter"]).not.toMatch(/admin/i);
    expect(dict.vi["tag.open_filter"]).not.toMatch(/admin/i);
  });

  it("encryption metadata unavailable copy exists in every locale", () => {
    const expected: Record<(typeof SUPPORTED_LANGS)[number], {
      title: string;
      desc: string;
      retry: string;
    }> = {
      en: {
        title: "Couldn’t load encryption state",
        desc: "Check your connection and try again. Notes on this device are unchanged.",
        retry: "Retry",
      },
      vi: {
        title: "Không tải được trạng thái mã hóa",
        desc: "Kiểm tra kết nối rồi thử lại. Note trên thiết bị này không bị mất.",
        retry: "Thử lại",
      },
      de: {
        title: "Verschlüsselungsstatus konnte nicht geladen werden",
        desc: "Prüfe die Verbindung und versuche es erneut. Notizen auf diesem Gerät bleiben erhalten.",
        retry: "Erneut versuchen",
      },
      es: {
        title: "No se pudo cargar el estado de cifrado",
        desc: "Comprueba la conexión e inténtalo de nuevo. Las notas en este dispositivo no cambian.",
        retry: "Reintentar",
      },
      fr: {
        title: "Impossible de charger l’état de chiffrement",
        desc: "Vérifiez la connexion et réessayez. Les notes sur cet appareil restent inchangées.",
        retry: "Réessayer",
      },
      pt: {
        title: "Não foi possível carregar o estado de encriptação",
        desc: "Verifique a ligação e tente novamente. As notas neste dispositivo não são alteradas.",
        retry: "Tentar novamente",
      },
      ja: {
        title: "暗号化状態を読み込めませんでした",
        desc: "接続を確認して再試行してください。この端末のノートは変わりません。",
        retry: "再試行",
      },
      ko: {
        title: "암호화 상태를 불러오지 못했습니다",
        desc: "연결을 확인한 뒤 다시 시도하세요. 이 기기의 노트는 그대로입니다.",
        retry: "다시 시도",
      },
      zh: {
        title: "无法加载加密状态",
        desc: "请检查网络后重试。此设备上的笔记不会丢失。",
        retry: "重试",
      },
    };
    for (const lang of SUPPORTED_LANGS) {
      const d = dict[lang] as Record<string, string>;
      expect(d["unlock.metadata_unavailable"], lang).toBe(expected[lang].title);
      expect(d["unlock.metadata_unavailable_desc"], lang).toBe(expected[lang].desc);
      expect(d["common.retry"], lang).toBe(expected[lang].retry);
      expect(d["unlock.metadata_conflict"], lang).toBeTruthy();
      expect(d["unlock.metadata_conflict_desc"], lang).toBeTruthy();
    }
  });

  it("PWA update toast copy is one keep-notes line with no site-data cleanup key", () => {
    const expected: Record<(typeof SUPPORTED_LANGS)[number], string> = {
      en: "Reload to get the latest version. Your notes and history will be kept.",
      vi: "Tải lại để dùng bản mới. Note và lịch sử vẫn được giữ.",
      de: "Neu laden, um die neueste Version zu erhalten. Deine Notizen und dein Verlauf bleiben erhalten.",
      es: "Recarga para obtener la versión más reciente. Tus notas e historial se conservarán.",
      fr: "Rechargez pour obtenir la dernière version. Vos notes et votre historique seront conservés.",
      pt: "Recarregue para obter a versão mais recente. As suas notas e histórico serão mantidos.",
      ja: "最新版を使うには再読み込みしてください。ノートと履歴は保持されます。",
      ko: "최신 버전을 쓰려면 다시 로드하세요. 노트와 기록은 유지됩니다.",
      zh: "重新加载以使用最新版本。您的笔记和历史记录将保留。",
    };
    for (const lang of SUPPORTED_LANGS) {
      const d = dict[lang] as Record<string, string>;
      expect(d["update.description"], lang).toBe(expected[lang]);
      expect(d, lang).not.toHaveProperty("update.fallback_cleanup");
    }
  });

  it("isLang validates only supported codes", () => {
    expect(isLang("vi")).toBe(true);
    expect(isLang("en")).toBe(true);
    expect(isLang("xx")).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it("detectFromNavigator falls back to en when no match", () => {
    vi.stubGlobal("navigator", { language: "ru-RU", languages: ["ru-RU"] });
    expect(detectFromNavigator()).toBe("en");
    vi.stubGlobal("navigator", { language: "ja-JP", languages: ["ja-JP", "en"] });
    expect(detectFromNavigator()).toBe("ja");
    vi.stubGlobal("navigator", { language: "de-DE", languages: ["de-DE"] });
    expect(detectFromNavigator()).toBe("de");
    vi.stubGlobal("navigator", { language: "pt-BR", languages: ["pt-BR"] });
    expect(detectFromNavigator()).toBe("pt");
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

describe("I18nProvider — browser locale & storage sync", () => {
  it("uses the browser locale without making a geolocation request", () => {
    vi.stubGlobal("navigator", { language: "vi-VN", languages: ["vi-VN", "en-US"] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId("lang").textContent).toBe("vi");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("lang.ip_detected")).toBeNull();
  });

  it("prefers a saved language without making a network request", () => {
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
    await waitFor(() => {
      expect(screen.getByTestId("zen").textContent).toBe(dict.vi["mode.zen.enter"]);
    });

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

  it("renders Vietnamese trigger + shortcut hints", async () => {
    setup("vi");
    expect(await screen.findByRole("button", { name: /Chế độ/ })).toBeInTheDocument();
  });

  it("renders Japanese trigger", async () => {
    setup("ja");
    expect(await screen.findByRole("button", { name: /モード/ })).toBeInTheDocument();
  });

  it("renders English trigger by default", () => {
    setup("en");
    expect(screen.getByRole("button", { name: /^Mode/ })).toBeInTheDocument();
    // Mode shortcut hints are hardcoded in JSX → language-independent contract.
    expect(dict.en["mode.zen.desc"]).toBeTruthy();
    expect(dict.vi["mode.zen.desc"]).not.toBe(dict.en["mode.zen.desc"]);
  });

  it("keeps the latest choice when locale chunks resolve after rapid switches", async () => {
    function RapidPicker() {
      const { setLang, t } = useI18n();
      return (
        <>
          <button onClick={() => setLang("fr")}>fr</button>
          <button onClick={() => setLang("ja")}>ja</button>
          <span data-testid="rapid-label">{t("menu.export")}</span>
        </>
      );
    }

    render(
      <I18nProvider>
        <RapidPicker />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fr" }));
    fireEvent.click(screen.getByRole("button", { name: "ja" }));
    await Promise.all([loadDictionary("fr"), loadDictionary("ja")]);

    await waitFor(() => {
      expect(screen.getByTestId("rapid-label")).toHaveTextContent(dict.ja["menu.export"]);
    });
  });
});
