import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

async function loadArchiveModule() {
  try {
    const modulePath = "../extension-archive";
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

describe("extension package contract", () => {
  it("round-trips source bytes through a deterministic archive", async () => {
    const archive = await loadArchiveModule();
    expect(archive).not.toBeNull();
    if (!archive) return;

    const entries = archive.collectExtensionPackageEntries();
    const first = archive.buildDeterministicZip(entries);
    const second = archive.buildDeterministicZip(entries);
    const unpacked = archive.readZipEntries(first);

    expect(first.equals(second)).toBe(true);
    expect([...unpacked.keys()]).toEqual(entries.map((entry) => entry.path));
    for (const entry of entries) {
      expect(unpacked.get(entry.path)?.equals(entry.data)).toBe(true);
    }
  });

  it("ships an archive that exactly matches the current extension source", async () => {
    const archive = await loadArchiveModule();
    expect(archive).not.toBeNull();
    if (!archive) return;

    const source = archive.collectExtensionPackageEntries();
    const shipped = archive.readZipEntries(
      readFileSync("public/syrin-note-sidepanel.zip"),
    );

    expect([...shipped.keys()]).toEqual(source.map((entry) => entry.path));
    for (const entry of source) {
      expect(shipped.get(entry.path)?.equals(entry.data)).toBe(true);
    }
  });
});
