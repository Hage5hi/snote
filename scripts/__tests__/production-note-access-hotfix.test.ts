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
    expect(envTypes).toContain("readonly VITE_CAPABILITY_ROUTES_ENABLED?: string;");
    expect(envExample).toMatch(/^VITE_CAPABILITY_ROUTES_ENABLED=false$/m);
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
});
