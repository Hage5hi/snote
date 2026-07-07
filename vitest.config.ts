import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.{test,spec}.{ts,tsx}",
      "chrome-extension/__tests__/**/*.{test,spec}.{js,ts}",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "virtual:pwa-register": path.resolve(__dirname, "./src/test/stubs/virtual-pwa-register.ts"),
    },
  },
});
