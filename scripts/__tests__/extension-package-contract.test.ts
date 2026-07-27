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
  it("pins text inputs to LF and archives as binary across platforms", () => {
    const attributes = readFileSync(".gitattributes", "utf8");

    for (const extension of ["html", "js", "json", "md"]) {
      expect(attributes).toContain(`*.${extension} text eol=lf`);
    }
    expect(attributes).toContain("*.zip binary");
  });

  it("round-trips source bytes through a deterministic archive", async () => {
    const archive = await loadArchiveModule();
    expect(archive).not.toBeNull();
    if (!archive) return;

    expect(
      archive.canonicalizeExtensionEntry(
        "README.md",
        Buffer.from("one\r\ntwo\rthree\n"),
      ),
    ).toEqual(Buffer.from("one\ntwo\nthree\n"));
    expect(
      archive.canonicalizeExtensionEntry(
        "icon.png",
        Buffer.from([0x0d, 0x0a, 0x00]),
      ),
    ).toEqual(Buffer.from([0x0d, 0x0a, 0x00]));

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
