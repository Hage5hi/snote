import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
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
