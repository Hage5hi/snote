import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

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
    rollupOptions: {
      output: {
        // Split heavy vendors so first paint pulls only what's needed.
        manualChunks(id) {
          // Obfuscate the admin chunk so its name doesn't hint at admin
          // functionality in the network tab.
          if (id.includes("/pages/AdminPanel")) {
            return "chunk-a8f3";
          }
          if (!id.includes("node_modules")) return;
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
        },
      },
    },
  },
}));
