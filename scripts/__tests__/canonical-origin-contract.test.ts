import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CANONICAL_ORIGIN = "https://note.syrin.online";

const publicSurfaces = [
  "index.html",
  "README.md",
  "public/robots.txt",
  "public/sitemap.xml",
  "src/pages/RawView.tsx",
  "src/lib/pwa-update-readiness.ts",
  ".github/workflows/pwa-update-smoke-post-deploy.yml",
] as const;

describe("canonical production origin", () => {
  it("uses note.syrin.online on every public app surface", () => {
    for (const path of publicSurfaces) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain(CANONICAL_ORIGIN);
      expect(source, path).not.toContain("https://syrin.online");
      expect(source, path).not.toContain("https://snote.lovable.app");
      expect(source, path).not.toContain("https://www.note.syrin.online");
    }
  });

  it("labels capability security as a deferred target instead of live production", () => {
    const readme = readFileSync("README.md", "utf8");
    const findings = readFileSync("docs/security-findings.md", "utf8");

    expect(readme).toMatch(
      /Production currently runs dual-mode `NotePage`\s+\(`legacyOnly=\{!canary\}`\)/,
    );
    expect(readme).toContain("`capabilityRoutesEnabled` true");
    expect(readme).toContain("c5914c8e");
    expect(readme).toContain("findings §3e");
    expect(readme).not.toMatch(/capability\s+routes disabled/);
    expect(readme).not.toMatch(/SPA canary remain off/);
    expect(readme).toMatch(/SQL 240 is not applied/);
    expect(readme).toMatch(/soak ≥48h starts from this live canary/);
    expect(readme).toMatch(
      /The capability model below is the target post-cutover architecture, not the\s+authorization model currently active in production\./,
    );
    expect(findings).toContain(
      "Production legacy write path is still live (`NotePage` `legacyOnly`,",
    );
    expect(findings).toMatch(
      /Additive SQL `20260722000000_capability_backend\.sql` is\s+applied on production/,
    );
    expect(readme).toContain("`writes_enabled=true`");
    expect(readme).toContain("`private_realtime_enabled=false`");
    expect(readme).not.toMatch(/kill switch closed/);
    expect(findings).toContain(
      "`writes_enabled=true`, `private_realtime_enabled=false`",
    );
    expect(findings).not.toContain("Kill switch still closed");
    expect(findings).not.toContain(
      "closed kill switch (`writes_enabled=false`, `private_realtime_enabled=false`).",
    );
    expect(findings).toMatch(
      /Additive SQL `20260727000000_capability_sync_conflict_codes\.sql` is\s+(?:also\s+)?applied/,
    );
    expect(findings).toContain("append_encryption_conflict");
    expect(findings).toContain("checkpoint_encryption_conflict");
    expect(findings).toContain("checkpoint_version_conflict");
    expect(findings).toMatch(
      /Atomic SQL `20260724000000_atomic_capability_cutover\.sql` has not been\s+applied\./,
    );
    expect(findings).toContain("Capability SPA canary is on");
    expect(findings).not.toContain("Capability SPA canary remains off");
    expect(findings).toContain("capabilityRoutesEnabled` is true");
    expect(findings).toContain("VITE_CAPABILITY_ROUTES_ENABLED` is true");
    expect(findings).toMatch(
      /Do not treat 220, 270, `writes_enabled`, or this\s+origin canary as authorization to apply 240 or flip\s+`private_realtime_enabled`/,
    );
    expect(findings).not.toContain(
      "Do not treat 220 or 270 as authorization to flip the canary or apply 240.",
    );
    expect(findings).not.toContain(
      "Atomic SQL `20260724000000_atomic_capability_cutover.sql` is applied",
    );
    expect(findings).toContain(
      "## 1. Legacy metadata and crawler previews — production verified",
    );
    expect(findings).toMatch(
      /The\s+deployed `note-meta` endpoint is production-verified\./,
    );
    expect(findings).toContain(
      "Worker crawler containment is live and verified in production.",
    );
    expect(findings).not.toContain("tombstone deploy unverified");
    expect(findings).not.toContain(
      "production deployment has not been independently verified",
    );
  });

  it("records production daily backups without PITR or cutover authorization", () => {
    const findings = readFileSync("docs/security-findings.md", "utf8");

    expect(findings).toContain(
      "## 3c. Production daily backups — verified, no PITR",
    );
    expect(findings).toMatch(
      /Lovable Cloud → More → Cloud → Database →\s+Backups/,
    );
    expect(findings).toContain("There is no PITR / point-in-time UI");
    expect(findings).toContain("14 daily automated snapshots");
    expect(findings).toContain("2026-09-01 19:33:22 UTC");
    expect(findings).toContain("2026-08-19 19:34:43 UTC");
    expect(findings).toContain("Nothing was restored");
    expect(findings).toContain(
      "Worst-case loss on restore-to-snapshot is up to ~24h of writes",
    );
    expect(findings).toMatch(
      /This is not authorization to call\s+`capability_runtime_set`/,
    );
    expect(findings).not.toContain("PITR checkpoint is available");
  });

  it("records the production writes_enabled go without treating it as later cutover steps", () => {
    const findings = readFileSync("docs/security-findings.md", "utf8");

    expect(findings).toContain(
      "## 3d. Production writes_enabled go — verified, Realtime still false",
    );
    expect(findings).toContain("2026-09-02 ~11:23 ICT");
    expect(findings).toContain("production not staging");
    expect(findings).toContain(
      "SELECT public.capability_runtime_set(true, false);",
    );
    expect(findings).toContain("via Lovable Cloud `query_database`");
    expect(findings).toContain("`singleton=true`, `writes_enabled=true`");
    expect(findings).toContain("`private_realtime_enabled=false`");
    expect(findings).toContain("2026-09-02 04:24:07.235188+00");
    expect(findings).toContain("`capability_note_import_legacy` is absent");
    expect(findings).toContain(
      "fe18302fb650b98eaee414e34e61db5cf06acc61",
    );
    expect(findings).toContain("`capabilityRoutesEnabled` false");
    expect(findings).toContain("2026-09-01T19:55:38.557Z");
    expect(findings).toContain(
      'POST `/functions/v1/note-session` `{}` still 401 `{"error":"unauthorized"}`',
    );
    expect(findings).toMatch(
      /this flip does not mount `CutoverNotePage` and is not a\s+canary/,
    );
    expect(findings).toContain(
      "This is not canary, not SQL 240, not origin/Worker deploy, not",
    );
    expect(findings).toContain("`private_realtime_enabled`, and not soak.");
    expect(findings).toContain("Later origin canary is §3e");
    expect(findings).not.toContain("PITR checkpoint is available");
  });

  it("records the production origin canary go without treating it as soak, 240, or Realtime", () => {
    const findings = readFileSync("docs/security-findings.md", "utf8");

    expect(findings).toContain(
      "## 3e. Production origin canary go — capabilityRoutesEnabled true",
    );
    expect(findings).toContain("2026-09-02 ~12:01 ICT");
    expect(findings).toContain("snote-g4-origin");
    expect(findings).toContain("wrangler pages deploy");
    expect(findings).toContain("`build:release`");
    expect(findings).toContain("`VITE_CAPABILITY_ROUTES_ENABLED=true` only");
    expect(findings).toContain("`VITE_CAPABILITY_AUTH_ENABLED`");
    expect(findings).toContain("`VITE_ADMIN_PANEL_ENABLED` stayed false");
    expect(findings).toContain("https://note.syrin.online/");
    expect(findings).toContain("do not advertise `snote.lovable.app`");
    expect(findings).toContain(
      "c5914c8e8f953d5e8ed877d8c892b6e0941095e7",
    );
    expect(findings).toContain("`capabilityRoutesEnabled` true");
    expect(findings).toContain("2026-09-02T05:00:59.705Z");
    expect(findings).toContain("1788325246305-qzfta8za");
    expect(findings).toContain(
      "6277a076-c0d3-4464-b5b5-5b0432011029",
    );
    expect(findings).toContain("32ccfc35");
    expect(findings).toContain("Kill switch unchanged");
    expect(findings).toMatch(
      /POST `\/functions\/v1\/legacy-note-open` `\{\}` still 410 `\{"found":false\}`/,
    );
    expect(findings).toMatch(
      /POST `\/functions\/v1\/note-session` `\{\}` still 401 `\{"error":"unauthorized"\}`/,
    );
    expect(findings).toContain("syrin-prerender");
    expect(findings).toContain("`9fcc58bc` / `b4d1a94e`");
    expect(findings).toContain("not redeployed");
    expect(findings).toContain("`legacyOnly={!canary}`");
    expect(findings).toContain("Home still does not mint capabilities");
    expect(findings).toContain(
      "This is not SQL 240, not Realtime, not soak-complete.",
    );
    expect(findings).toContain(
      "Soak ≥48h starts from this live canary.",
    );
    expect(findings).not.toContain("PITR checkpoint is available");
  });

  it("pins the cutover backup gate to daily snapshots, not a PITR checkpoint", () => {
    const cutover = readFileSync(
      "docs/security/atomic-capability-cutover.md",
      "utf8",
    );

    expect(cutover).not.toContain("backup/PITR checkpoint");
    expect(cutover).not.toContain(
      "Take and verify a recoverable backup/PITR checkpoint",
    );
    expect(cutover).not.toContain("PITR checkpoint is available");
    expect(cutover).toMatch(
      /Verify the Lovable Cloud daily snapshot panel \(see\s+`docs\/security-findings\.md` §3c\)/,
    );
    expect(cutover).toContain("PITR is not available on this Tiny project");
    expect(cutover).toContain("Daily snapshot verify is done as of 2026-09-02");
    expect(cutover).toContain("2026-09-02 ~11:23 ICT");
    expect(cutover).toContain(
      "`SELECT public.capability_runtime_set(true, false);`",
    );
    expect(cutover).toContain("`writes_enabled=true`");
    expect(cutover).toContain("`private_realtime_enabled=false`");
    expect(cutover).toContain("findings §3d");
    expect(cutover).toContain("findings §3e");
    expect(cutover).toContain(
      "c5914c8e8f953d5e8ed877d8c892b6e0941095e7",
    );
    expect(cutover).toContain("`capabilityRoutesEnabled` true");
    expect(cutover).toMatch(/Soak ≥48h starts from\s+that live canary/);
    expect(cutover).toMatch(
      /Do not treat snapshot verify as `capability_runtime_set`/,
    );
    expect(cutover).toMatch(
      /This is not `LEGACY_SHARE_CUTOFF`, soak-complete,\s+SQL 240, Worker redeploy, or `private_realtime_enabled`/,
    );
    expect(cutover).not.toMatch(
      /This is not `LEGACY_SHARE_CUTOFF`, canary, soak, SQL 240/,
    );
    expect(cutover).toContain("Do not skip remaining order");
  });
});
