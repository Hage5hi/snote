import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Inject `<link rel="prefetch">` hints into the built index.html for the
// editor route's heavy chunks. They're imported dynamically by NotePage and
// not reachable from the entry's static graph, so Vite's automatic
// modulepreload doesn't cover them. `prefetch` is idle-priority — it doesn't
// compete with critical first-paint resources but lets the browser fetch
// these chunks during HTML parse instead of waiting for React mount + the
// onIdle warm-up in Home.tsx. Improves Lighthouse "Network dependency tree".
function prefetchEditorChunks(): Plugin {
  const targets = ["NotePage", "cm-vendor", "yjs-vendor", "md-vendor"];
  return {
    name: "prefetch-editor-chunks",
    apply: "build",
    transformIndexHtml(_html, ctx) {
      if (!ctx.bundle) return;
      const tags = [];
      for (const name of targets) {
        const chunk = Object.values(ctx.bundle).find(
          (c) =>
            c.type === "chunk" &&
            c.fileName.startsWith(`assets/${name}-`) &&
            c.fileName.endsWith(".js"),
        );
        if (chunk) {
          tags.push({
            tag: "link",
            attrs: { rel: "prefetch", href: `/${chunk.fileName}` },
            injectTo: "head" as const,
          });
        }
      }
      return tags;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
    prefetchEditorChunks(),
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
        globPatterns: ["**/*.{js,css,html,svg,png,webp,woff,woff2,json,ico}"],
        // Exclude heavy lazy-loaded vendors + the markdown preview worker from
        // precache so first install stays light. They still get cached via the
        // browser HTTP cache on first use.
        globIgnores: [
          "**/mermaid-vendor-*",
          "**/wardley-*",
          "**/preview-worker-*",
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
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
            !/(?:^|\/)(?:mermaid-vendor|katex-vendor|hljs-vendor|qrcode-vendor|chunk-a8f3|UnlockForm|wardley|scene-|ogl-vendor)-/.test(
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
          if (id.includes("/react-dom/") || id.includes("/react-router") || id.match(/\/react\//)) {
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
}));
