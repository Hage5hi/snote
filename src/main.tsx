import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { registerAppUpdater } from "./lib/pwa-update";

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);

// Register the PWA service worker and show a persistent toast when a new
// version is available. See src/lib/pwa-update.ts for the rationale.
registerAppUpdater();

// Web Vitals — log to console for DevTools observation in any environment.
import("web-vitals").then(({ onINP, onLCP, onCLS }) => {
  const log = (name: string) => (m: { value: number }) =>
    console.log(`[perf] ${name}=${Math.round(m.value * 100) / 100}ms`);
  onINP(log("INP"));
  onLCP(log("LCP"));
  onCLS((m) => console.log(`[perf] CLS=${Math.round(m.value * 1000) / 1000}`));
});
