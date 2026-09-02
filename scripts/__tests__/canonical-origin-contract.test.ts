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
      /Production currently runs in legacy mode with capability\s+routes disabled\./,
    );
    expect(readme).toMatch(
      /The capability model below is the target post-cutover architecture, not the\s+authorization model currently active in production\./,
    );
    expect(findings).toContain(
      "Production legacy write path is still live (`NotePage` `legacyOnly`,",
    );
    expect(findings).toMatch(
      /Additive SQL `20260722000000_capability_backend\.sql` is\s+applied on production/,
    );
    expect(findings).toContain(
      "closed kill switch (`writes_enabled=false`, `private_realtime_enabled=false`).",
    );
    expect(findings).toMatch(
      /Additive SQL `20260727000000_capability_sync_conflict_codes\.sql` is\s+(?:also\s+)?applied/,
    );
    expect(findings).toContain("append_encryption_conflict");
    expect(findings).toContain("checkpoint_encryption_conflict");
    expect(findings).toContain("checkpoint_version_conflict");
    expect(findings).toMatch(
      /Kill switch still closed: `writes_enabled=false`,\s+`private_realtime_enabled=false`/,
    );
    expect(findings).toMatch(
      /Atomic SQL `20260724000000_atomic_capability_cutover\.sql` has not been\s+applied\./,
    );
    expect(findings).toContain("Capability SPA canary remains off");
    expect(findings).toContain(
      "Do not treat 220 or 270 as authorization to flip the canary or apply 240.",
    );
    expect(findings).not.toContain(
      "Atomic SQL `20260724000000_atomic_capability_cutover.sql` is applied",
    );
    expect(findings).not.toContain("capabilityRoutesEnabled` is true");
    expect(findings).not.toContain("VITE_CAPABILITY_ROUTES_ENABLED` is true");
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
    expect(cutover).toMatch(
      /re-check the\s+latest snapshot timestamp immediately before any later `writes_enabled`\s+go/,
    );
    expect(cutover).toMatch(
      /Do not treat snapshot verify as `capability_runtime_set`/,
    );
    expect(cutover).toContain("`writes_enabled`, canary, or 240 authorization");
  });
});
