# Syrin Note Side Panel — v1.3.6

- **Honest fallback state** — the panel uses the browser-owned
  `offline`/`online-unverified` signal and no longer issues cross-origin
  reachability or CSP probes that require host permissions.
- **Diagnostics schema v3** — exported diagnostics explicitly record CSP as
  `not-inspected` and distinguish network, handshake, and timeout failures.
- **No permission expansion** — the extension still requests only
  `sidePanel` and `storage`, with no host permissions.
- **Release parity** — manifest, README, store copy, release notes, and the
  shipped ZIP are built and verified from the same source version.
