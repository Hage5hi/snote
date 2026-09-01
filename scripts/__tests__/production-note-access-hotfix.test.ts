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
    expect(envExample).toMatch(/^VITE_CAPABILITY_ROUTES_ENABLED=false$/m);

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

  it("defers the capability HTTP client until a capability owner action", () => {
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
    const shareRevokeAt = revokeLink.indexOf('supabase.functions.invoke("share-revoke"');
    expect(shareRevokeAt).toBeGreaterThan(0);
    expect(revokeLink.slice(0, shareRevokeAt)).toContain("if (capabilityAccess)");
    expect(revokeLink.slice(shareRevokeAt)).not.toContain('import("@/lib/capability/client")');
  });
});
