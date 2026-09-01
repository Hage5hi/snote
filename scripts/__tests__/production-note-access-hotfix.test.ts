import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("production note access hotfix", () => {
  it("keeps ordinary-note capability routing strictly opt-in", () => {
    const app = source("src/App.tsx");
    const envTypes = source("src/vite-env.d.ts");
    const envExample = source(".env.example");

    expect(app).toContain('const NotePage = lazy(() => import("./pages/NotePage"));');
    expect(app).toMatch(
      /const capabilityRoutesEnabled\s*=\s*import\.meta\.env\.VITE_CAPABILITY_ROUTES_ENABLED === "true";/,
    );
    expect(app).toContain("<NotePage legacyOnly={!capabilityRoutesEnabled} />");
    expect(app).not.toContain("<NotePage legacyOnly />");
    expect(app.match(/<SharePage legacyOnly=\{!capabilityRoutesEnabled\} \/>/g)).toHaveLength(2);
    expect(app).not.toMatch(/<SharePage\s*\/>/);
    expect(envTypes).toContain("readonly VITE_CAPABILITY_ROUTES_ENABLED?: string;");
    expect(envTypes).toContain("readonly VITE_CAPABILITY_AUTH_ENABLED?: string;");
    expect(envExample).toMatch(/^VITE_CAPABILITY_ROUTES_ENABLED=false$/m);
    expect(envExample).toMatch(/^VITE_CAPABILITY_AUTH_ENABLED=false$/m);

    const client = source("src/lib/capability/client.ts");
    const postAt = client.indexOf("const post = async");
    const flagCheckAt = client.indexOf(
      'import.meta.env.VITE_CAPABILITY_ROUTES_ENABLED !== "true"',
      postAt,
    );
    const fetcherAt = client.indexOf("await fetcher(", postAt);
    expect(postAt).toBeGreaterThanOrEqual(0);
    expect(flagCheckAt).toBeGreaterThan(postAt);
    expect(fetcherAt).toBeGreaterThan(flagCheckAt);
    expect(client.slice(flagCheckAt, fetcherAt)).toContain("capability API unavailable");

    const auth = source("src/lib/capability/auth.ts");
    const defaultSource = auth.slice(auth.indexOf("export function createDefaultCapabilityAuthSource"));
    expect(defaultSource).toContain('import.meta.env.VITE_CAPABILITY_AUTH_ENABLED === "true"');
    expect(defaultSource).toContain('import.meta.env.VITE_CAPABILITY_ROUTES_ENABLED === "true"');
  });

  it("keeps SplitView, Home, and RawView on the legacy backend", () => {
    const split = source("src/pages/SplitView.tsx");
    const home = source("src/pages/Home.tsx");
    const raw = source("src/pages/RawView.tsx");

    expect(split).toContain('const NotePage = lazy(() => import("./NotePage"));');
    expect(split).toContain("legacyOnly");
    expect(home).toContain('import("@/integrations/supabase/client")');
    expect(home).not.toContain('import { supabase } from "@/integrations/supabase/client";');
    expect(home).not.toContain("createCapabilityApi");
    expect(home).not.toContain("createLegacyNoteApi");
    expect(home).not.toContain("note-snapshot:");
    expect(raw).toContain('import { supabase } from "@/integrations/supabase/client";');
    expect(raw).not.toContain("createLegacyNoteApi");
  });

  it("keeps ShareDialog, LockButton, and LegacyNotePage off a static capability HTTP client import", () => {
    const staticCreateApi = /import\s*\{[^}]*createCapabilityApi[^}]*\}\s*from\s*["']@\/lib\/capability\/client["']/;
    const shareDialog = source("src/components/note/ShareDialog.tsx");
    const lockButton = source("src/components/note/LockButton.tsx");
    const legacyNotePage = source("src/pages/LegacyNotePage.tsx");

    expect(shareDialog).not.toMatch(staticCreateApi);
    expect(lockButton).not.toMatch(staticCreateApi);
    expect(legacyNotePage).not.toMatch(staticCreateApi);
    expect(shareDialog).toContain('import("@/lib/capability/client")');
    expect(lockButton).toContain('import("@/lib/capability/client")');
    expect(legacyNotePage).toContain('import("@/lib/capability/client")');

    const revokeLink = shareDialog.slice(shareDialog.indexOf("const revokeLink"));
    const capabilityGuardAt = revokeLink.indexOf("if (capabilityAccess)");
    const shareRevokeAt = revokeLink.indexOf('supabase.functions.invoke("share-revoke"');
    expect(capabilityGuardAt).toBeGreaterThanOrEqual(0);
    expect(shareRevokeAt).toBeGreaterThan(capabilityGuardAt);
    expect(revokeLink.slice(0, capabilityGuardAt)).not.toContain("loadCapabilityApi");
    expect(revokeLink.slice(capabilityGuardAt, shareRevokeAt)).toContain("loadCapabilityApi");
    expect(revokeLink.slice(shareRevokeAt)).not.toContain("loadCapabilityApi");
  });

  it("keeps canary-off NotePage and SharePage chunks off a static capability HTTP client import", () => {
    const staticCreateApi = /import\s*\{[^}]*createCapabilityApi[^}]*\}\s*from\s*["']@\/lib\/capability\/client["']/;
    const staticCapabilityProvider =
      /import\s*\{[^}]*CapabilityYjsProvider[^}]*\}\s*from\s*["']@\/lib\/yjs\/capability-provider["']/;
    const notePage = source("src/pages/NotePage.tsx");
    const sharePage = source("src/pages/SharePage.tsx");
    const app = source("src/App.tsx");
    const split = source("src/pages/SplitView.tsx");
    const home = source("src/pages/Home.tsx");
    const raw = source("src/pages/RawView.tsx");

    const withoutTypeImports = (src: string) => src.replace(/typeof import\([^)]*\)/g, "");
    expect(notePage).not.toMatch(staticCreateApi);
    expect(sharePage).not.toMatch(staticCreateApi);
    expect(notePage).not.toMatch(staticCapabilityProvider);
    expect(sharePage).not.toMatch(staticCapabilityProvider);
    expect(withoutTypeImports(notePage)).toContain('import("@/lib/capability/client")');
    expect(withoutTypeImports(sharePage)).toContain('import("@/lib/capability/client")');
    expect(withoutTypeImports(notePage)).toContain('import("@/lib/yjs/capability-provider")');
    expect(withoutTypeImports(sharePage)).toContain('import("@/lib/yjs/capability-provider")');
    expect(notePage).toContain("export function CutoverNotePage");
    expect(app).not.toContain("CutoverNotePage");
    expect(split).not.toContain("CutoverNotePage");
    expect(home).not.toContain("CutoverNotePage");
    expect(raw).not.toContain("CutoverNotePage");
  });

  it("fail-closes the admin SPA unless VITE_ADMIN_PANEL_ENABLED is true", () => {
    const app = source("src/App.tsx");
    const envTypes = source("src/vite-env.d.ts");
    const envExample = source(".env.example");
    const panel = source("src/pages/AdminPanel.tsx");

    expect(app).toMatch(
      /const adminPanelEnabled\s*=\s*import\.meta\.env\.VITE_ADMIN_PANEL_ENABLED === "true";/,
    );

    const dispatcher = app.slice(app.indexOf("function SlugDispatcher"));
    const noteArmStart = dispatcher.indexOf('if (slug === "note")');
    const nextArmStart = dispatcher.indexOf("/\\.md$/i.test(slug)");
    expect(noteArmStart).toBeGreaterThanOrEqual(0);
    expect(nextArmStart).toBeGreaterThan(noteArmStart);
    const noteArm = dispatcher.slice(noteArmStart, nextArmStart);

    expect(noteArm).toContain("adminPanelEnabled");
    expect(noteArm.indexOf("adminPanelEnabled")).toBeLessThan(noteArm.indexOf("<AdminPanel"));
    expect(noteArm).toContain("<NotFound");
    expect(noteArm).not.toContain("NotePage");
    expect(noteArm).not.toContain("capabilityRoutesEnabled");
    expect(noteArm).not.toContain("VITE_CAPABILITY_ROUTES_ENABLED");

    expect(envTypes).toContain("readonly VITE_ADMIN_PANEL_ENABLED?: string;");
    expect(envExample).toMatch(/^VITE_ADMIN_PANEL_ENABLED=false$/m);

    const defaultExportAt = panel.indexOf("export default function AdminPanel");
    const flagCheckAt = panel.indexOf(
      'import.meta.env.VITE_ADMIN_PANEL_ENABLED !== "true"',
      defaultExportAt,
    );
    const notFoundAt = panel.indexOf("return <NotFound />", flagCheckAt);
    const firstEffectAt = panel.indexOf("useEffect", defaultExportAt);
    const firstInvokeAt = panel.indexOf("functions.invoke", defaultExportAt);
    const hashLoginAt = panel.indexOf("window.location.hash", defaultExportAt);
    expect(defaultExportAt).toBeGreaterThanOrEqual(0);
    expect(flagCheckAt).toBeGreaterThan(defaultExportAt);
    expect(notFoundAt).toBeGreaterThan(flagCheckAt);
    expect(firstEffectAt).toBeGreaterThan(notFoundAt);
    expect(firstInvokeAt).toBeGreaterThan(notFoundAt);
    expect(hashLoginAt).toBeGreaterThan(notFoundAt);
  });
});
