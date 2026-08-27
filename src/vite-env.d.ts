/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_CAPABILITY_AUTH_ENABLED?: string;
  readonly VITE_CAPABILITY_ROUTES_ENABLED?: string;
}
