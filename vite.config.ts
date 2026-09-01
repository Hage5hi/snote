import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import {
  resolveReleaseIdentity,
  revalidateReleaseIdentity,
} from "./scripts/release-identity";

// Editor-route chunks (NotePage, cm-vendor, yjs-vendor, md-vendor) are warmed
// by the device-aware, intent-driven prefetch in src/pages/Home.tsx, which
// deliberately skips mobile / Save-Data / slow-network / low-memory clients.
// A previous build-time plugin also injected unconditional
// `<link rel="prefetch">` hints for those chunks, which bypassed that gating
// and fetched ~290 KB gz on every Home load regardless of device. Removed —
// the runtime warm-up is the single source of truth for this policy.

// https://vitejs.dev/config/
// Build-time identity. Stamped into both the bundle (__BUILD_ID__) and a
// public /version.json file. Used at runtime by src/lib/pwa-update.ts to
// detect "the deployed version drifted from the version this tab booted with"
// and surface the Update toast — even when the SW machinery hasn't fired
// onNeedRefresh yet (or the user has SW disabled entirely).
const BUILD_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const RELEASE_IDENTITY = resolveReleaseIdentity();

function emitVersionJson(capabilityRoutesEnabled: boolean): Plugin {
  return {
    name: "emit-version-json",
    apply: "build" as const,
    generateBundle() {
      const deployedSha = revalidateReleaseIdentity(RELEASE_IDENTITY);
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({
          buildId: BUILD_ID,
          builtAt: new Date().toISOString(),
          deployedSha,
          capabilityRoutesEnabled,
        }),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const capabilityRoutesEnabled = env.VITE_CAPABILITY_ROUTES_ENABLED === "true";

  return {
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      // Keep the existing public/manifest.webmanifest as-is.
      manifest: false,
      // Switched from "autoUpdate" → "prompt" so we control the activation
      // moment from the app shell: src/lib/pwa-update.ts shows a toast with an
      // explicit "Update" button and only swaps to the new SW after the user
      // accepts. Avoids the "silent stale tab" trap where autoUpdate claims
      // the new SW but the page in memory still runs old JS until the user
      // happens to refresh — which previously forced users to clear cookies /
      // site-data to actually get the new version, losing recents + pins.
      registerType: "prompt",
      // We register the SW ourselves in src/main.tsx so we can wire onNeedRefresh
      // / onOfflineReady into the i18n + toast layer.
      injectRegister: false,
      // SW only activates in production builds — preview iframes stay clean.
      devOptions: { enabled: false },
      workbox: {
        clientsClaim: false,
        skipWaiting: false,
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff,woff2,json,ico}"],
        // Keep the Home app-shell precached. Exclude version.json and the lazy
        // editor/crypto graph so the first SW install does not race NotePage
        // import(). Those chunks use the first-use HTTP cache; offline note
        // needs a prior online open.
        globIgnores: [
          "**/version.json",
          "**/NotePage-*",
          "**/CutoverNotePage-*",
          "**/LegacyNotePage-*",
          "**/SplitView-*",
          "**/RawView-*",
          "**/Editor-*",
          "**/Preview-*",
          "**/UnlockForm-*",
          "**/crypto-*",
          "**/cm-vendor-*",
          "**/yjs-vendor-*",
          "**/md-vendor-*",
          "**/supabase-vendor-*",
          "**/katex-vendor-*",
          "**/hljs-vendor-*",
          "**/qrcode-vendor-*",
          "**/markdown-fallback-*",
          "**/mermaid-vendor-*",
          "**/wardley-*",
          "**/preview-worker-*",
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/auth\//,
          /^\/assets\//,
          /^\/sw\.js$/,
          /^\/version\.json/,
        ],
        // Bumped from 5 MB → 8 MB so a large vendor chunk (e.g. a future
        // mermaid/katex bump) can’t silently break precache install and
        // leave the new SW stuck in "redundant" state, which is one of the
        // root causes of users marooned on an old build.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Drop old Workbox precache entries on activate so disk usage stays
        // bounded and stale assets can’t be served by accident.
        cleanupOutdatedCaches: true,
      },
    }),
    emitVersionJson(capabilityRoutesEnabled),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    modulePreload: {
      // Vite's default emits <link rel="modulepreload"> for every chunk it
      // thinks the entry needs. The chunks below are lazy-only (loaded on
      // explicit user action like opening a note, viewing an encrypted note,
      // sharing via QR, viewing /n/note admin, or rendering a wardley diagram)
      // and must stay OUT of the eager preload list — otherwise users pay the
      // network cost on every page load even when they never use those
      // features. The runtime `__vitePreload` helper still fetches them when
      // the dynamic import() call site executes (i.e., on first use).
      resolveDependencies: (_filename, deps) =>
        deps.filter(
          (dep) =>
            !/(?:^|\/)(?:mermaid-vendor|katex-vendor|hljs-vendor|qrcode-vendor|chunk-a8f3|UnlockForm|wardley|scene|ogl-vendor)-/.test(
              dep,
            ),
        ),
    },
    rollupOptions: {
      output: {
        // Obfuscate the admin chunk's file name so its name doesn't hint at
        // admin functionality in the network tab. We do this via
        // `chunkFileNames` rather than `manualChunks` because a manual
        // chunk for AdminPanel pulled its shared deps (e.g. `use-toast`)
        // into the same chunk, which then forced the entry to STATICALLY
        // import that chunk just to get the shared deps — defeating the
        // lazy split entirely. Letting Rollup chunk AdminPanel naturally
        // (as a side-effect of `lazy(() => import(...))`) keeps shared
        // utilities in the entry where they belong.
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name === "AdminPanel") {
            return "assets/chunk-a8f3-[hash].js";
          }
          return "assets/[name]-[hash].js";
        },
        manualChunks(id) {
          // The worker itself stays runtime-cached, but its shared renderer is
          // also the no-worker fallback. Give that dynamic main-thread chunk a
          // non-worker name so Workbox precaches it for first-use offline mode.
          if (id.includes("/src/lib/markdown/preview-worker-renderer")) {
            return "markdown-fallback";
          }
          // Pin Vite's `__vitePreload` helper to its own tiny chunk.
          // Without this, Rollup hoists the helper into whichever lazy chunk
          // it happens to land in (historically `mermaid-vendor`), which
          // then forces the entry to STATICALLY import that heavy chunk
          // just to get the helper — defeating the entire lazy-load split
          // and pulling ~740KB of mermaid into the initial graph on every
          // page. Routing it to a dedicated chunk keeps the helper out of
          // the heavy vendor chunks entirely.
          if (id.includes("vite/preload-helper")) {
            return "preload-helper";
          }
          // Home background scenes — each scene is its own chunk, loaded only
          // when the user picks it from the ThemeToggle dropdown. Must NOT be
          // in modulepreload (see resolveDependencies filter above).
          if (id.includes("/src/components/home/scenes/CyberLinhKhi")) {
            return "scene-cyber-linh-khi";
          }
          if (id.includes("/src/components/home/scenes/EtherealAurora")) {
            return "scene-ethereal-aurora";
          }
          if (id.includes("/src/components/home/scenes/ObsidianInk")) {
            return "scene-obsidian-ink";
          }
          if (id.includes("/src/components/home/scenes/DigitalConstellation")) {
            return "scene-digital-constellation";
          }
          if (id.includes("/src/components/home/scenes/NeonVapor")) {
            return "scene-neon-vapor";
          }
          if (id.includes("/src/components/home/scenes/TerminalBoot")) {
            return "scene-terminal-boot";
          }
          if (!id.includes("node_modules")) return;
          // OGL — WebGL micro-lib used only by scenes. Keep as its own vendor
          // chunk so multiple scenes can share it without duplication.
          if (id.includes("/ogl/") || id.includes("node_modules/ogl/")) {
            return "ogl-vendor";
          }
          // Keep eager runtime packages in exact package chunks. The former
          // `/react-dom/` substring also matched `@floating-ui/react-dom`,
          // accidentally placing UI-positioning code in React's budget.
          if (id.includes("/react-router")) {
            return "router-vendor";
          }
          if (id.includes("/@floating-ui/")) {
            return "floating-ui-vendor";
          }
          if (/(?:^|\/)react-dom\//.test(id) || /(?:^|\/)react\//.test(id)) {
            return "react-vendor";
          }
          if (id.includes("@codemirror") || id.includes("y-codemirror")) {
            return "cm-vendor";
          }
          if (id.includes("/yjs/") || id.includes("y-indexeddb") || id.includes("y-protocols")) {
            return "yjs-vendor";
          }
          if (id.includes("/marked/") || id.includes("/dompurify/")) {
            return "md-vendor";
          }
          if (id.includes("@radix-ui")) {
            return "radix-vendor";
          }
          if (id.includes("@supabase")) {
            return "supabase-vendor";
          }
          if (id.includes("/qrcode/")) {
            return "qrcode-vendor";
          }
          // Eager third-party libs used by the app shell (App.tsx providers,
          // Topbar, Home, CommandPalette). Without an explicit chunk they
          // default into the app entry chunk and push it over the bundle-size
          // budget. They are all statically imported on first paint, so
          // grouping them into one eager `vendor` chunk doesn't change what
          // loads — it just moves stable third-party code out of the
          // frequently-changing entry (better long-term caching) and keeps the
          // entry under budget. NOTE: deliberately excludes `lucide-react`,
          // which is tree-shaken per-icon — a blanket match would drag
          // lazy-route-only icons into this eager chunk.
          if (
            id.includes("/tailwind-merge/") ||
            id.includes("/clsx/") ||
            id.includes("/class-variance-authority/") ||
            id.includes("/@tanstack/") ||
            id.includes("/sonner/") ||
            id.includes("/react-helmet-async/") ||
            id.includes("/react-fast-compare/") ||
            id.includes("/shallowequal/") ||
            id.includes("/invariant/") ||
            id.includes("/cmdk/")
          ) {
            return "vendor";
          }
          // Phase 1: pre-declare chunks for heavy editor libs.
          // They are not imported anywhere yet — chunks stay empty until
          // Phase 3 lazy-imports them inside the render worker / Preview /
          // Editor. Declaring the rule early keeps the split stable and
          // makes the bundle gate (grep on initial chunk) deterministic.
          if (id.includes("/mermaid/")) {
            return "mermaid-vendor";
          }
          if (id.includes("/katex/")) {
            return "katex-vendor";
          }
          if (id.includes("/highlight.js/")) {
            return "hljs-vendor";
          }
          // NOTE: do NOT lump @replit/codemirror-vim into cm-vendor — it's
          // dynamically imported by Editor.tsx only when the user enables
          // Vim mode, so it must be a separate chunk to stay lazy.
        },
      },
    },
  },
  };
});
