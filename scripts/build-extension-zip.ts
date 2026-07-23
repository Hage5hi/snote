import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildDeterministicZip,
  collectExtensionPackageEntries,
} from "./extension-archive";

const ZIP_PATH = "public/syrin-note-sidepanel.zip";
const METADATA_PATH = "public/syrin-note-sidepanel.zip.manifest.json";

const manifest = JSON.parse(
  readFileSync("chrome-extension/manifest.json", "utf8"),
) as { version: string };
const entries = collectExtensionPackageEntries();
const zip = buildDeterministicZip(entries);
const sha256 = createHash("sha256").update(zip).digest("hex");
const metadata = {
  $comment:
    "Deterministic drift guard. Rebuild with `bun run scripts/build-extension-zip.ts`; verify with `bun run scripts/verify-extension-zip.ts`.",
  version: manifest.version,
  bytes: zip.length,
  sha256,
};

writeFileSync(ZIP_PATH, zip);
writeFileSync(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(
  `build-extension-zip: wrote ${entries.length} files (version=${manifest.version} bytes=${zip.length})`,
);
