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
import { EditorSkeleton } from "./components/note/EditorSkeleton";
import { I18nProvider } from "./i18n/provider";

// Lazy-load heavy routes so the editor / admin bundles only load when needed.
const NotePage = lazy(() => import("./pages/NotePage"));
const RawView = lazy(() => import("./pages/RawView"));
const SplitView = lazy(() => import("./pages/SplitView"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

const queryClient = new QueryClient();
// EditorSkeleton mimics the topbar + editor layout so there's no shift when
// the lazy NotePage chunk lands.
const EditorFallback = <EditorSkeleton />;
const PlainFallback = (
  <div className="flex h-svh items-center justify-center bg-background">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-foreground/60" />
  </div>
);

/**
 * SlugDispatcher inspects the single-segment path and routes to the right view.
 */
function SlugDispatcher() {
  const { slug = "" } = useParams();
  if (slug === "note") {
    return (
      <Suspense fallback={PlainFallback}>
        <AdminPanel />
      </Suspense>
    );
  }
  if (/\.md$/i.test(slug)) {
    return (
      <Suspense fallback={PlainFallback}>
        <RawView />
      </Suspense>
    );
  }
  if (slug.includes("+")) {
    return (
      <Suspense fallback={EditorFallback}>
        <SplitView />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={EditorFallback}>
      <NotePage />
    </Suspense>
  );
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        {/* Toasters live OUTSIDE TooltipProvider — Tooltip's Provider passes a
            ref to its first child and these toaster wrappers are plain function
            components, which produces a noisy "Function components cannot be
            given refs" warning. */}
        <Toaster />
        <Sonner />
        <TooltipProvider delayDuration={250}>
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <CommandPalette />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/:slug" element={<SlugDispatcher />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>
  </ThemeProvider>
);

export default App;
