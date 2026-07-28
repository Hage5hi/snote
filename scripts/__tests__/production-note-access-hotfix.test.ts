import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("production note access hotfix", () => {
  it("keeps ordinary note entry points on the deployed legacy backend", () => {
    const app = source("src/App.tsx");
    const split = source("src/pages/SplitView.tsx");
    const home = source("src/pages/Home.tsx");
    const raw = source("src/pages/RawView.tsx");

    expect(app).toContain('const NotePage = lazy(() => import("./pages/NotePage"));');
    expect(app).toContain("<NotePage legacyOnly />");
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
