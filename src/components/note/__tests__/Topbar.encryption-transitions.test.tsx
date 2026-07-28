import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Topbar } from "../topbar/Topbar";
import type { CapabilityAccess } from "@/lib/capability/url";

const harness = vi.hoisted(() => ({
  shareDialogProps: vi.fn(),
}));

vi.mock("@/components/ui/separator", () => ({ Separator: () => null }));
vi.mock("@/components/ShortcutHelp", () => ({ ShortcutHelp: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/SceneToggle", () => ({ SceneToggle: () => null }));
vi.mock("@/components/note/PresenceDots", () => ({ PresenceDots: () => null }));
vi.mock("@/components/note/HistoryDialog", () => ({ HistoryDialog: () => null }));
vi.mock("@/components/note/LockButton", () => ({
  LockButton: () => <button type="button">Encryption transition</button>,
}));
vi.mock("@/components/note/PinButton", () => ({ PinButton: () => null }));
vi.mock("@/components/note/WordGoalDialog", () => ({ WordGoalDialog: () => null }));
vi.mock("@/components/note/ShareDialog", () => ({
  ShareDialog: (props: unknown) => {
    harness.shareDialogProps(props);
    return null;
  },
}));
vi.mock("@/components/note/topbar/TopbarBrand", () => ({ TopbarBrand: () => null }));
vi.mock("@/components/note/topbar/WordCountTrigger", () => ({ WordCountTrigger: () => null }));
vi.mock("@/components/note/topbar/ViewControls", () => ({ ViewControls: () => null }));
vi.mock("@/components/note/topbar/ExportMenu", () => ({ ExportMenu: () => null }));
vi.mock("@/components/note/topbar/NoteMenu", () => ({ NoteMenu: () => null }));
vi.mock("@/components/note/topbar/ModeMenu", () => ({ ModeMenu: () => null }));
vi.mock("@/components/note/topbar/HelpMenu", () => ({ HelpMenu: () => null }));
vi.mock("@/hooks/use-scene-theme", () => ({ useSceneTheme: () => ({ scene: "none" }) }));
vi.mock("@/hooks/use-narrow-viewport", () => ({ useNarrowViewport: () => false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const ownerAccess: CapabilityAccess = {
  slug: "secret",
  scope: "owner",
  token: "a".repeat(43),
};

function renderTopbar(
  overrides: Partial<ComponentProps<typeof Topbar>> & { currentShareUrl?: string } = {},
) {
  const props: ComponentProps<typeof Topbar> = {
    slug: "secret",
    doc: new Y.Doc(),
    charCount: 0,
    wordCount: 0,
    users: [],
    showPreview: false,
    onTogglePreview: vi.fn(),
    scrollSync: false,
    onToggleScrollSync: vi.fn(),
    zen: false,
    onToggleZen: vi.fn(),
    typewriter: false,
    onToggleTypewriter: vi.fn(),
    focusLine: false,
    onToggleFocusLine: vi.fn(),
    getContent: () => "",
    isEncrypted: false,
    capabilityAccess: ownerAccess,
    paginated: false,
    onTogglePagination: vi.fn(),
    ...overrides,
  };

  return render(<Topbar {...props} />);
}

describe("Topbar encryption transitions", () => {
  it("forwards the sanitized current share URL", () => {
    renderTopbar({ currentShareUrl: "https://example.test/secret#safe-key" });

    expect(harness.shareDialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentShareUrl: "https://example.test/secret#safe-key" }),
    );
  });

  it.each([
    ["wide", false],
    ["narrow", true],
  ])("hides the LockButton in the %s layout when transitions are disabled", (_layout, narrowOverride) => {
    renderTopbar({ allowEncryptionTransitions: false, narrowOverride });

    expect(screen.queryByRole("button", { name: "Encryption transition" })).not.toBeInTheDocument();
  });

  it("keeps the owner LockButton visible by default", () => {
    renderTopbar({ narrowOverride: false });

    expect(screen.getByRole("button", { name: "Encryption transition" })).toBeInTheDocument();
  });

  it("keeps the owner LockButton visible when transitions are explicitly enabled", () => {
    renderTopbar({ allowEncryptionTransitions: true, narrowOverride: true });

    expect(screen.getByRole("button", { name: "Encryption transition" })).toBeInTheDocument();
  });

  it("keeps the existing non-owner capability scope gate", () => {
    renderTopbar({
      allowEncryptionTransitions: true,
      capabilityAccess: { ...ownerAccess, scope: "edit" },
    });

    expect(screen.queryByRole("button", { name: "Encryption transition" })).not.toBeInTheDocument();
  });
});
