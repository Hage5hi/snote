/** @vitest-environment node */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalFunctionEnv } from "../create-local-function-env";

const cleanupRoots: string[] = [];

function createGeneratedWorkdir(): string {
  const root = mkdtempSync(join(tmpdir(), "snote-local-env-test-"));
  cleanupRoots.push(root);
  mkdirSync(join(root, "supabase", "functions"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createLocalFunctionEnv", () => {
  it("creates one owner-only 32-byte HMAC secret inside the generated workdir", () => {
    const root = createGeneratedWorkdir();

    const envPath = createLocalFunctionEnv(root);

    expect(envPath).toBe(join(root, "supabase", "functions", ".env"));
    expect(readFileSync(envPath, "utf8")).toMatch(
      /^CAPABILITY_HMAC_SECRET=[0-9a-f]{64}\n$/,
    );
    if (process.platform !== "win32") {
      expect(statSync(envPath).mode & 0o777).toBe(0o600);
    }
  });

  it("refuses to overwrite an existing environment file", () => {
    const root = createGeneratedWorkdir();
    const envPath = join(root, "supabase", "functions", ".env");
    writeFileSync(envPath, "KEEP_EXISTING=1\n", "utf8");

    expect(() => createLocalFunctionEnv(root)).toThrow();
    expect(readFileSync(envPath, "utf8")).toBe("KEEP_EXISTING=1\n");
  });
});
