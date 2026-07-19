// Simulates a transient CI failure fetching --diff-with artifacts: the
// prev-run directory does not exist when inspect-focus-trap starts, but
// materialises a few hundred ms later. With --diff-retries + backoff
// the tool must recover and still produce a byte-stable --diff-out.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS } from "../_helpers/focus-trap-inspect";

function prevCsvRow(file: string, failureReason: string): string {
  return CSV_COLUMNS.map((c) =>
    c === "file" ? file
    : c === "failureReason"
      ? (/[",\n\r]/.test(failureReason) ? `"${failureReason.replace(/"/g, '""')}"` : failureReason)
      : "",
  ).join(",");
}

async function runInspect(argv: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", "scripts/inspect-focus-trap.ts", ...argv], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout!.on("data", (d) => { stdout += d.toString(); });
    child.stderr!.on("data", (d) => { stderr += d.toString(); });
    child.on("exit", (code) => resolve({ status: code, stdout, stderr }));
  });
}

describe("inspect-focus-trap --diff-with retry/backoff", () => {
  it("recovers from a transient missing prev-run dir and produces a deterministic diff", async () => {
    const workRoot = mkdtempSync(join(tmpdir(), "ft-retry-"));
    const scanRoot = join(workRoot, "test-results");
    const prevDir  = join(workRoot, "prev");           // NOT yet created
    const invalidDir = join(workRoot, "inv");
    const diffOut = join(workRoot, "diff.csv");
    const outJson = join(workRoot, "summary.json");

    // Current-run artifact: healthy in prev, schema fail now.
    mkdirSync(join(scanRoot, "a-spec-chromium-retry0"), { recursive: true });
    const artifact = join(scanRoot, "a-spec-chromium-retry0", "focus-trap-escape-x.json");
    writeFileSync(artifact, JSON.stringify({ focusHistory: [{ event: 42 }] }));

    // Materialise the prev-run CSV after 400ms — enough to force at
    // least one retry with --diff-retry-delay-ms=150 (backoff 150,300).
    const materialisePrev = delay(400).then(() => {
      mkdirSync(prevDir, { recursive: true });
      writeFileSync(
        join(prevDir, "focus-trap-inspect-summary.valid.csv"),
        [CSV_COLUMNS.join(","), prevCsvRow(artifact, "")].join("\n") + "\n",
      );
    });

    const [res] = await Promise.all([
      runInspect([
        "--scan-root", scanRoot,
        "--out", outJson,
        "--diff-with", prevDir,
        "--diff-out", diffOut,
        "--diff-retries", "5",
        "--diff-retry-delay-ms", "150",
        "--invalid-dir", invalidDir,
      ]),
      materialisePrev,
    ]);

    // Exit 2 (schema failure present) but the diff must still be written.
    expect(res.status).toBe(2);
    expect(res.stdout).toMatch(/\(retry\) diff-with attempt \d+ failed/);

    const csv = readFileSync(diffOut, "utf8");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("file,prevFailureReason,prevSchemaPointer,currFailureReason,currSchemaPointer");
    // Exactly one changed row for our artifact (prev empty → curr schema).
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain(artifact);
    expect(lines[1]).toContain("/focusHistory/0/event");

    // Deterministic: a second run against the (now-present) prev dir
    // must produce byte-identical CSV.
    const res2 = await runInspect([
      "--scan-root", scanRoot, "--out", outJson,
      "--diff-with", prevDir, "--diff-out", diffOut,
      "--diff-retries", "5", "--diff-retry-delay-ms", "150",
      "--invalid-dir", invalidDir,
    ]);
    expect(res2.status).toBe(2);
    expect(readFileSync(diffOut, "utf8")).toBe(csv);
  }, 30_000);

  it("gives up cleanly after --diff-retries exhaust when prev-run never appears", async () => {
    const workRoot = mkdtempSync(join(tmpdir(), "ft-retry-fail-"));
    const scanRoot = join(workRoot, "test-results");
    mkdirSync(join(scanRoot, "a-spec-chromium-retry0"), { recursive: true });
    writeFileSync(
      join(scanRoot, "a-spec-chromium-retry0", "focus-trap-escape-x.json"),
      JSON.stringify({ focusHistory: [{ event: "keydown" }] }),
    );

    const res = await runInspect([
      "--scan-root", scanRoot,
      "--out", join(workRoot, "summary.json"),
      "--diff-with", join(workRoot, "never-appears"),
      "--diff-retries", "2",
      "--diff-retry-delay-ms", "50",
      "--invalid-dir", join(workRoot, "inv"),
    ]);
    // No invalid artifacts → exit 0 despite the diff read failure.
    expect(res.status).toBe(0);
    // Exactly 2 retry lines + 1 final warn ("failed after 3 attempt(s)").
    expect((res.stdout.match(/\(retry\) diff-with attempt/g) || []).length).toBe(2);
    expect(res.stdout).toContain("failed after 3 attempt(s)");
  }, 30_000);
});
