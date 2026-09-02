import {
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
  SearchQuery,
  closeSearchPanel,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { runScopeHandlers } from "@codemirror/view";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  STORAGE_KEY,
  detectLang,
  isLang,
  loadDictionary,
  translateLoaded,
  type Lang,
  type TKey,
} from "@/i18n";
import { cn } from "@/lib/utils";
import { countSearchMatches, selectAllSearchMatches } from "./match-count";
import { replaceOpenField, setReplaceOpen } from "./replace-open";
import { saveSearchFlags } from "./search-flags";

const SEARCH_PANEL_TEST_ID = "note-search-panel";

function useDocumentI18n() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadDictionary(lang).then(() => {
      if (!cancelled) setRev((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  useEffect(() => {
    const onLang = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (isLang(next)) setLang(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && isLang(event.newValue)) setLang(event.newValue);
    };
    window.addEventListener("i18n:lang-changed", onLang);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("i18n:lang-changed", onLang);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => translateLoaded(lang, key, vars),
    // rev forces a render once the locale chunk arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, rev],
  );
  return { t };
}

const iconBtn =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

function IconButton({
  label,
  onClick,
  children,
  expanded,
  controls,
  popup,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  expanded?: boolean;
  controls?: string;
  popup?: "menu";
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={controls}
          aria-haspopup={popup}
          disabled={disabled}
          onClick={onClick}
          className={iconBtn}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function SearchPanel({ view }: { view: EditorView }) {
  const { t } = useDocumentI18n();
  const query = getSearchQuery(view.state);
  const replaceOpen = view.state.field(replaceOpenField, false) ?? false;
  const readOnly = view.state.readOnly;
  const matches = countSearchMatches(view.state, query);
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const replaceRowId = useId();
  const settingsMenuId = useId();

  const setFindNode = (el: HTMLInputElement | null) => {
    findRef.current = el;
    el?.setAttribute("main-field", "true");
  };

  useLayoutEffect(() => {
    const q = getSearchQuery(view.state);
    if (findRef.current && document.activeElement !== findRef.current) {
      findRef.current.value = q.search;
    }
    if (replaceRef.current && document.activeElement !== replaceRef.current) {
      replaceRef.current.value = q.replace;
    }
  }, [view.state]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (settingsBtnRef.current?.contains(target) || settingsMenuRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [settingsOpen]);

  const commit = (patch: Partial<{
    search: string;
    replace: string;
    caseSensitive: boolean;
    regexp: boolean;
    wholeWord: boolean;
  }>) => {
    const current = getSearchQuery(view.state);
    const next = new SearchQuery({
      search: patch.search ?? findRef.current?.value ?? current.search,
      replace: patch.replace ?? replaceRef.current?.value ?? current.replace,
      caseSensitive: patch.caseSensitive ?? current.caseSensitive,
      regexp: patch.regexp ?? current.regexp,
      wholeWord: patch.wholeWord ?? current.wholeWord,
    });
    if (
      next.caseSensitive !== current.caseSensitive
      || next.regexp !== current.regexp
      || next.wholeWord !== current.wholeWord
    ) {
      saveSearchFlags({
        caseSensitive: next.caseSensitive,
        regexp: next.regexp,
        wholeWord: next.wholeWord,
      });
    }
    if (!next.eq(current)) view.dispatch({ effects: setSearchQuery.of(next) });
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && settingsOpen) {
      event.preventDefault();
      event.stopPropagation();
      setSettingsOpen(false);
      return;
    }
    if (event.key === "Tab" && panelRef.current) {
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      )].filter((el) => !el.closest("[inert]"));
      if (focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
          return;
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
          return;
        }
      }
    }
    if (runScopeHandlers(view, event.nativeEvent, "search-panel")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Enter") return;
    if (event.target === findRef.current) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (event.target === replaceRef.current) {
      event.preventDefault();
      replaceNext(view);
    }
  };

  const countLabel = matches
    ? matches.total === 0
      ? t("editor.search.no_results")
      : t("editor.search.match_count", { current: matches.current, total: matches.total })
    : "";

  const chevronLabel = replaceOpen
    ? t("editor.search.close_replace")
    : t("editor.search.open_replace");

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={0}>
      <div
        ref={panelRef}
        role="search"
        data-testid={SEARCH_PANEL_TEST_ID}
        data-replace-open={replaceOpen ? "true" : "false"}
        aria-label={t("shortcuts.label.find")}
        onKeyDown={onPanelKeyDown}
        className="snote-search-panel relative ml-auto flex w-[min(26rem,100%)] max-w-full flex-col gap-1 rounded-xl border border-border bg-card/95 p-1.5 text-card-foreground shadow-lg backdrop-blur-sm"
      >
        <div className="flex items-center gap-1">
          <IconButton
            label={chevronLabel}
            expanded={replaceOpen}
            controls={replaceRowId}
            disabled={readOnly}
            onClick={() => {
              view.dispatch({ effects: setReplaceOpen.of(!replaceOpen) });
            }}
          >
            {replaceOpen ? (
              <ChevronDown className="size-4" strokeWidth={1.75} />
            ) : (
              <ChevronUp className="size-4" strokeWidth={1.75} />
            )}
          </IconButton>

          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("editor.search.find")}</span>
            <input
              ref={setFindNode}
              data-testid="note-search-find"
              type="text"
              name="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={t("editor.search.find")}
              aria-label={t("editor.search.find")}
              defaultValue={query.search}
              onInput={(event) => commit({ search: event.currentTarget.value })}
              className="h-8 w-full rounded-md px-2.5 pr-16 text-sm"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1.5">
              {countLabel ? (
                <span
                  data-testid="note-search-count"
                  className={cn(
                    "text-xs tabular-nums",
                    matches && matches.total === 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                  aria-live="polite"
                >
                  {countLabel}
                </span>
              ) : null}
              <Search className="size-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            </span>
          </label>

          <IconButton label={t("editor.search.next")} onClick={() => findNext(view)}>
            <ArrowDown className="size-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton label={t("editor.search.previous")} onClick={() => findPrevious(view)}>
            <ArrowUp className="size-4" strokeWidth={1.75} />
          </IconButton>

          <div ref={settingsBtnRef}>
            <IconButton
              label={t("editor.search.settings")}
              expanded={settingsOpen}
              popup="menu"
              controls={settingsOpen ? settingsMenuId : undefined}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <SlidersHorizontal className="size-4" strokeWidth={1.75} />
            </IconButton>
          </div>

          <IconButton label={t("editor.search.close")} onClick={() => closeSearchPanel(view)}>
            <X className="size-4" strokeWidth={1.75} />
          </IconButton>
        </div>

        <div
          id={replaceRowId}
          className="snote-search-replace"
          data-open={replaceOpen && !readOnly ? "true" : "false"}
          data-testid="note-search-replace-row"
          {...(replaceOpen && !readOnly ? {} : { inert: true })}
          aria-hidden={!(replaceOpen && !readOnly)}
        >
          <div className="snote-search-replace-inner">
            <div className="flex items-center gap-1 pl-9">
              <label className="min-w-0 flex-1">
                <span className="sr-only">{t("editor.search.replace")}</span>
                <input
                  ref={replaceRef}
                  data-testid="note-search-replace"
                  type="text"
                  name="replace"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={t("editor.search.replace")}
                  aria-label={t("editor.search.replace")}
                  defaultValue={query.replace}
                  onInput={(event) => commit({ replace: event.currentTarget.value })}
                  className="h-8 w-full rounded-md px-2.5 text-sm"
                />
              </label>
              <button
                type="button"
                className="h-8 shrink-0 whitespace-nowrap rounded-md bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => replaceNext(view)}
              >
                {t("editor.search.replace")}
              </button>
              <button
                type="button"
                className="h-8 shrink-0 whitespace-nowrap rounded-md bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => replaceAll(view)}
              >
                {t("editor.search.replace_all")}
              </button>
            </div>
          </div>
        </div>
        {settingsOpen ? (
          <div
            ref={settingsMenuRef}
            id={settingsMenuId}
            role="menu"
            aria-label={t("editor.search.settings")}
            className="absolute right-1.5 top-full z-50 mt-1 min-w-[13.5rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <OptionItem
              checked={query.caseSensitive}
              onToggle={() => commit({ caseSensitive: !query.caseSensitive })}
            >
              {t("editor.search.match_case")}
            </OptionItem>
            <OptionItem
              checked={query.regexp}
              onToggle={() => commit({ regexp: !query.regexp })}
            >
              {t("editor.search.regexp")}
            </OptionItem>
            <OptionItem
              checked={query.wholeWord}
              onToggle={() => commit({ wholeWord: !query.wholeWord })}
            >
              {t("editor.search.by_word")}
            </OptionItem>
            <div className="my-1 h-px bg-muted" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:bg-accent"
              onClick={() => {
                selectAllSearchMatches(view);
                setSettingsOpen(false);
              }}
            >
              {t("editor.search.select_all")}
            </button>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function OptionItem({
  checked,
  disabled,
  onToggle,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:bg-accent disabled:opacity-60"
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <span className="flex size-4 items-center justify-center" aria-hidden>
        {checked ? <Check className="size-3.5" strokeWidth={2} /> : null}
      </span>
      {children}
    </button>
  );
}
