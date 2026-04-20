import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense } from "react";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import { CommandPalette } from "./components/CommandPalette";

// Lazy-load heavy routes so the editor / admin bundles only load when needed.
const NotePage = lazy(() => import("./pages/NotePage"));
const RawView = lazy(() => import("./pages/RawView"));
const SplitView = lazy(() => import("./pages/SplitView"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

const queryClient = new QueryClient();
const SuspenseFallback = (
  <div className="flex h-svh items-center justify-center bg-background">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-foreground/60" />
  </div>
);

/**
 * SlugDispatcher inspects the single-segment path and routes to the right view:
 *  - "/note"            → admin panel
 *  - ends with ".md"    → raw plaintext view
 *  - contains "+"       → split view
 *  - otherwise          → note editor
 */
function SlugDispatcher() {
  const { slug = "" } = useParams();
  if (slug === "note") {
    return (
      <Suspense fallback={SuspenseFallback}>
        <AdminPanel />
      </Suspense>
    );
  }
  if (/\.md$/i.test(slug)) {
    return (
      <Suspense fallback={SuspenseFallback}>
        <RawView />
      </Suspense>
    );
  }
  if (slug.includes("+")) {
    return (
      <Suspense fallback={SuspenseFallback}>
        <SplitView />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={SuspenseFallback}>
      <NotePage />
    </Suspense>
  );
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <QueryClientProvider client={queryClient}>
      {/* Toasters live OUTSIDE TooltipProvider — Tooltip's Provider passes a
          ref to its first child and these toaster wrappers are plain function
          components, which produces a noisy "Function components cannot be
          given refs" warning. */}
      <Toaster />
      <Sonner />
      <TooltipProvider>
        <BrowserRouter>
          <CommandPalette />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/:slug" element={<SlugDispatcher />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
