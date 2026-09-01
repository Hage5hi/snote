import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const split = readFileSync(resolve(process.cwd(), "src/pages/SplitView.tsx"), "utf8");
const home = readFileSync(resolve(process.cwd(), "src/pages/Home.tsx"), "utf8");
const notePageImport = readFileSync(resolve(process.cwd(), "src/lib/note-page-import.ts"), "utf8");

describe("PWA workbox + lazy NotePage contract", () => {
  it("keeps prompt + skipWaiting and does not let a waiting SW claim the old document", () => {
    expect(viteConfig).toContain('registerType: "prompt"');
    expect(viteConfig).toContain("injectRegister: false");
    expect(viteConfig).toContain("clientsClaim: false");
    expect(viteConfig).toContain("skipWaiting: false");
    expect(viteConfig).not.toContain("clientsClaim: true");
    expect(viteConfig).not.toContain('registerType: "autoUpdate"');
  });

  it("does not precache version.json or the lazy editor/crypto graph", () => {
    const ignores = [
      '"**/version.json"',
      '"**/NotePage-*"',
      '"**/cm-vendor-*"',
      '"**/yjs-vendor-*"',
      '"**/md-vendor-*"',
      '"**/supabase-vendor-*"',
      '"**/mermaid-vendor-*"',
      '"**/wardley-*"',
      '"**/preview-worker-*"',
    ];
    for (const pattern of ignores) {
      expect(viteConfig).toContain(pattern);
    }
    expect(viteConfig).toMatch(/first-use HTTP cache|prior online open/i);
  });

  it("denies navigateFallback for assets, sw.js, and version.json", () => {
    expect(viteConfig).toContain("/^\\/api\\//");
    expect(viteConfig).toContain("/^\\/auth\\//");
    expect(viteConfig).toContain("/^\\/assets\\//");
    expect(viteConfig).toContain("/^\\/sw\\.js$/");
    expect(viteConfig).toContain("/^\\/version\\.json/");
  });

  it("wraps the lazy NotePage import with timeout recovery and keeps Home eager", () => {
    expect(app).toContain("loadNotePage");
    expect(app).toContain('import Home from "./pages/Home"');
    expect(app).not.toMatch(/const Home = lazy/);
    expect(split).toContain("loadNotePage");
    expect(home).not.toContain("loadNotePage");
    expect(notePageImport).toContain("importWithTimeoutRetry");
    expect(notePageImport).toContain('import("@/pages/NotePage")');
    expect(notePageImport).toContain("recoverMaroonedPwaUpdateOnce");
  });

  it("does not ship a public sw-kill.js that replaces /sw.js", () => {
    expect(viteConfig).not.toContain("sw-kill.js");
    expect(app).not.toContain("sw-kill.js");
  });
});
