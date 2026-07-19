import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotePage from "../NotePage";

const harness = vi.hoisted(() => ({
  editorRender: vi.fn(),
  previewRender: vi.fn(),
  unlockRender: vi.fn(),
  idbConstruct: vi.fn(),
  providerConnect: vi.fn(),
  metaForSlug: vi.fn(),
  metaPromise: Promise.resolve({ data: null as Record<string, unknown> | null }),
}));

vi.mock("@/components/note/Editor", async () => {
  const { forwardRef } = await vi.importActual<typeof import("react")>("react");
  return {
    Editor: forwardRef(function Editor() {
      harness.editorRender();
      return <div data-testid="editor" />;
    }),
  };
});
vi.mock("@/components/note/Preview", () => ({
  Preview: () => {
    harness.previewRender();
    return <div data-testid="preview" />;
  },
}));
vi.mock("@/components/note/UnlockForm", () => ({
  UnlockForm: () => {
    harness.unlockRender();
    return <div role="dialog" aria-label="Unlock encrypted note" />;
  },
}));
vi.mock("@/components/note/Topbar", () => ({ Topbar: () => null }));
vi.mock("@/components/note/PageIndicator", () => ({ PageIndicator: () => null }));
vi.mock("@/components/note/GoalConfetti", () => ({ GoalConfetti: () => null }));
vi.mock("@/components/note/OutlineSidebar", () => ({ OutlineSidebar: () => null }));
vi.mock("@/components/app/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("lucide-react", () => ({ Loader2: () => <span aria-label="Loading encryption metadata" /> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, slug: string) => ({ maybeSingle: () => harness.metaForSlug(slug) }),
      }),
    }),
  },
}));
vi.mock("@/lib/yjs/doc-cache", () => ({
  acquireDoc: () => ({
    getText: () => ({
      toString: () => "",
      observe: vi.fn(),
      unobserve: vi.fn(),
    }),
  }),
  releaseDoc: vi.fn(),
}));
vi.mock("@/lib/yjs/provider", () => ({
  SupabaseYjsProvider: class {
    awareness = {};

    constructor(private readonly slug: string) {}

    setEncryption() {}
    setExpectedEncrypted() {}
    onAwareness() { return vi.fn(); }
    onSyncEvent() { return vi.fn(); }
    connect() {
      harness.providerConnect(this.slug);
      return Promise.resolve();
    }
    flushBeacon() {}
    destroy() { return Promise.resolve(); }
  },
}));
vi.mock("@/hooks/use-word-goal", () => ({ useWordGoal: () => ({ goal: null }), consumeGoalReached: () => false }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-zen-mode", () => ({ useZenMode: () => ({ zen: false, toggle: vi.fn() }) }));
vi.mock("@/hooks/use-typewriter-mode", () => ({ useTypewriterMode: () => ({ typewriter: false, toggle: vi.fn() }) }));
vi.mock("@/hooks/use-preview-visible", () => ({ usePreviewVisible: () => ({ visible: true, setVisible: vi.fn() }) }));
vi.mock("@/hooks/use-narrow-viewport", () => ({ useNarrowViewport: () => false }));
vi.mock("@/hooks/use-scroll-sync-enabled", () => ({ useScrollSyncEnabled: () => ({ enabled: false, toggle: vi.fn() }) }));
vi.mock("@/hooks/use-scroll-sync", () => ({ useScrollSync: vi.fn() }));
vi.mock("@/hooks/use-focus-line", () => ({ useFocusLine: () => ({ focusLine: false, toggle: vi.fn() }) }));
vi.mock("@/hooks/use-eink", () => ({ useEink: vi.fn() }));
vi.mock("@/hooks/use-vim-mode", () => ({ useVimMode: () => ({ vim: false }) }));
vi.mock("@/hooks/use-pagination", () => ({
  usePagination: () => ({ enabled: false, toggle: vi.fn(), flip: vi.fn(), page: 1, totalPages: 1 }),
}));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/crypto", () => ({
  deriveKey: vi.fn(), encryptBytes: vi.fn(), decryptBytes: vi.fn(), verifyCheck: vi.fn(), iterationsFor: () => 1,
}));
vi.mock("@/lib/recent-notes", () => ({ touchRecent: vi.fn() }));
vi.mock("@/lib/snapshots", () => ({ maybeSaveSnapshot: vi.fn(), recordOnSuddenDelete: vi.fn() }));
vi.mock("@/lib/yjs/identity", () => ({ getIdentity: () => ({ name: "Test", color: "#000" }) }));
vi.mock("@/lib/wiki-link", () => ({ WIKI_NAV_EVENT: "wiki-nav" }));
vi.mock("@/lib/ext-context", () => ({ isExtensionContext: false }));
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve();

    constructor(name: string) {
      harness.idbConstruct(name);
    }

    destroy() {}
  },
}));

function renderEmbedded() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NotePage embedSlug="secret" />
    </MemoryRouter>,
  );
}

function renderStandalone() {
  return render(
    <MemoryRouter
      initialEntries={["/secret"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/:slug" element={<NotePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NotePage encryption gate", () => {
  beforeEach(() => {
    harness.editorRender.mockClear();
    harness.previewRender.mockClear();
    harness.unlockRender.mockClear();
    harness.idbConstruct.mockClear();
    harness.providerConnect.mockClear();
    harness.metaForSlug.mockReset();
    harness.metaForSlug.mockImplementation(() => harness.metaPromise);
    window.location.hash = "";
  });

  it("does not mount embedded editor or preview while encryption metadata is loading", () => {
    harness.metaPromise = new Promise(() => {});

    renderEmbedded();

    expect(harness.editorRender).not.toHaveBeenCalled();
    expect(harness.previewRender).not.toHaveBeenCalled();
  });

  it("fails closed when the encryption metadata query returns an error", async () => {
    type FailedMetaResponse = { data: null; error: { message: string } };
    let resolveMeta!: (response: FailedMetaResponse) => void;
    const failedMeta = new Promise<FailedMetaResponse>((resolve) => {
      resolveMeta = resolve;
    });
    harness.metaForSlug.mockReturnValue(failedMeta);

    renderEmbedded();
    await waitFor(() => expect(harness.metaForSlug).toHaveBeenCalledWith("secret"));
    await act(async () => {
      resolveMeta({ data: null, error: { message: "metadata unavailable" } });
      await failedMeta;
    });

    expect(harness.editorRender).not.toHaveBeenCalled();
    expect(harness.previewRender).not.toHaveBeenCalled();
    expect(harness.idbConstruct).not.toHaveBeenCalled();
    expect(harness.providerConnect).not.toHaveBeenCalled();
  });

  it("closes the gate synchronously when an embedded note changes", async () => {
    const encryptedMetaPending = new Promise<{ data: Record<string, unknown> | null }>(() => {});
    harness.metaForSlug.mockImplementation((slug: string) => (
      slug === "plain"
        ? Promise.resolve({ data: { is_encrypted: false } })
        : encryptedMetaPending
    ));

    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotePage embedSlug="plain" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(harness.editorRender).toHaveBeenCalled());
    await waitFor(() => expect(harness.providerConnect).toHaveBeenCalledWith("plain"));

    harness.editorRender.mockClear();
    harness.previewRender.mockClear();
    harness.idbConstruct.mockClear();
    harness.providerConnect.mockClear();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotePage embedSlug="encrypted" />
      </MemoryRouter>,
    );

    expect(harness.editorRender).not.toHaveBeenCalled();
    expect(harness.previewRender).not.toHaveBeenCalled();
    await waitFor(() => expect(harness.metaForSlug).toHaveBeenCalledWith("encrypted"));
    expect(harness.idbConstruct).not.toHaveBeenCalledWith("note:encrypted");
    expect(harness.providerConnect).not.toHaveBeenCalledWith("encrypted");
  });

  it.each([
    ["embedded", renderEmbedded],
    ["standalone", renderStandalone],
  ])("shows the unlock gate without mounting %s editor or preview", async (_mode, renderPage) => {
    harness.metaPromise = Promise.resolve({
      data: {
        is_encrypted: true,
        enc_salt: "salt",
        enc_check: "check",
        enc_iterations: 1000,
        ydoc_state: "ciphertext",
      },
    });

    renderPage();
    await waitFor(() => expect(harness.unlockRender).toHaveBeenCalled());

    expect(harness.editorRender).not.toHaveBeenCalled();
    expect(harness.previewRender).not.toHaveBeenCalled();
  });
});
