import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense } from "react";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

// Lazy-load heavy routes so the editor / admin bundles only load when needed.
const NotePage = lazy(() => import("./pages/NotePage"));
const RawView = lazy(() => import("./pages/RawView"));
const SplitView = lazy(() => import("./pages/SplitView"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

const queryClient = new QueryClient();

const SuspenseFallback = <div className="h-svh bg-background" />;

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/note"
              element={
                <Suspense fallback={SuspenseFallback}>
                  <AdminPanel />
                </Suspense>
              }
            />
            {/* Raw plaintext view: /xxx.md → React route, decrypts encrypted notes locally */}
            <Route
              path="/:slugMd"
              element={
                <Suspense fallback={SuspenseFallback}>
                  <RawView />
                </Suspense>
              }
            />
            {/* Split view: /a+b */}
            <Route
              path="/:slugs"
              element={
                <Suspense fallback={SuspenseFallback}>
                  <SplitView />
                </Suspense>
              }
            />
            <Route
              path="/:slug"
              element={
                <Suspense fallback={SuspenseFallback}>
                  <NotePage />
                </Suspense>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
