import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SharePage from "../SharePage";

const TOKEN = "v".repeat(43);
const harness = vi.hoisted(() => ({
  openSession: vi.fn(),
  providerConstruct: vi.fn(),
  providerConnect: vi.fn(async () => {}),
  providerDestroy: vi.fn(async () => {}),
  preview: vi.fn(),
  unlock: vi.fn(),
  legacyInvoke: vi.fn(),
}));

vi.mock("@/lib/capability/client", () => ({
  createCapabilityApi: () => ({ openSession: harness.openSession }),
}));
vi.mock("@/lib/yjs/capability-provider", () => ({
  CapabilityYjsProvider: class {
    constructor(...args: unknown[]) { harness.providerConstruct(...args); }
    setExpectedEncrypted() {}
    connect = harness.providerConnect;
    destroy = harness.providerDestroy;
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: harness.legacyInvoke } },
}));
vi.mock("@/components/note/Preview", () => ({
  Preview: () => { harness.preview(); return <div data-testid="preview" />; },
}));
vi.mock("@/components/note/UnlockForm", () => ({
  UnlockForm: () => { harness.unlock(); return <div data-testid="unlock" />; },
}));
vi.mock("@/components/note/EditorSkeleton", () => ({ EditorSkeleton: () => <div data-testid="loading" /> }));
vi.mock("@/components/app/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/use-scene-theme", () => ({ useSceneTheme: () => ({ scene: "none" }) }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n/index", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("react-helmet-async", () => ({ Helmet: () => null }));
vi.mock("lucide-react", () => ({ ArrowLeft: () => null, Eye: () => null }));

function noteSession(encrypted = false) {
  return {
    noteId: "00000000-0000-4000-8000-000000000001",
    slug: "hidden-locator",
    scope: "view",
    realtimeToken: "header.payload.signature",
    realtimeExpiresAt: "2099-01-01T00:00:00.000Z",
    realtimeTopic: "note:00000000-0000-4000-8000-000000000001",
    syncStatus: "active",
    currentSequence: 0,
    payloadLimitBytes: 4_194_304,
    checkpointSequence: 0,
    checkpointVersion: null,
    checkpointPayload: null,
    checkpointEncryptionVersion: null,
    missingUpdates: [],
    encryption: {
      enabled: encrypted,
      version: encrypted ? 1 : 0,
      salt: encrypted ? "salt" : null,
      check: encrypted ? "check" : null,
      iterations: 1,
    },
  };
}

describe("SharePage capability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", `/s#view=${TOKEN}`);
  });

  it("opens /s#view through Bearer capability mode without invoking the legacy token API", async () => {
    harness.openSession.mockResolvedValue(noteSession(false));

    render(<MemoryRouter initialEntries={[`/s#view=${TOKEN}`]}><SharePage /></MemoryRouter>);

    await waitFor(() => expect(harness.preview).toHaveBeenCalled());
    expect(harness.openSession).toHaveBeenCalledWith(TOKEN);
    expect(harness.legacyInvoke).not.toHaveBeenCalled();
    expect(harness.providerConstruct.mock.calls[0][0]).toEqual({ slug: null, scope: "view", token: TOKEN });
  });

  it("does not mount a document or provider for an encrypted note before unlock", async () => {
    harness.openSession.mockResolvedValue(noteSession(true));

    render(<MemoryRouter initialEntries={[`/s#view=${TOKEN}`]}><SharePage /></MemoryRouter>);

    await waitFor(() => expect(harness.unlock).toHaveBeenCalled());
    expect(harness.providerConstruct).not.toHaveBeenCalled();
    expect(harness.preview).not.toHaveBeenCalled();
  });
});
