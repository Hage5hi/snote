import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  collectExtensionPackageEntries,
  readZipEntries,
} from "./extension-archive";

const ZIP_PATH = "public/syrin-note-sidepanel.zip";
const METADATA_PATH = "public/syrin-note-sidepanel.zip.manifest.json";
const SOURCE_MANIFEST_PATH = "chrome-extension/manifest.json";

function fail(message: string): never {
  throw new Error(`verify-extension-zip: ${message}`);
}

const zip = readFileSync(ZIP_PATH);
const metadata = JSON.parse(readFileSync(METADATA_PATH, "utf8")) as {
  version: string;
  bytes: number;
  sha256: string;
};
const sourceManifest = JSON.parse(
  readFileSync(SOURCE_MANIFEST_PATH, "utf8"),
) as { version: string };
const shipped = readZipEntries(zip);
const source = collectExtensionPackageEntries();
const sourcePaths = source.map((entry) => entry.path);
const shippedPaths = [...shipped.keys()];

if (metadata.version !== sourceManifest.version) {
  fail(`metadata version ${metadata.version} != source ${sourceManifest.version}`);
}
if (metadata.bytes !== zip.length) {
  fail(`metadata bytes ${metadata.bytes} != archive ${zip.length}`);
}
const sha256 = createHash("sha256").update(zip).digest("hex");
if (metadata.sha256 !== sha256) {
  fail(`metadata sha256 ${metadata.sha256} != archive ${sha256}`);
}
if (JSON.stringify(shippedPaths) !== JSON.stringify(sourcePaths)) {
  fail(
    `file set/order drift\nsource=${JSON.stringify(sourcePaths)}\narchive=${JSON.stringify(shippedPaths)}`,
  );
}
for (const entry of source) {
  if (!shipped.get(entry.path)?.equals(entry.data)) {
    fail(`source bytes drift for ${entry.path}`);
  }
}
const shippedManifest = JSON.parse(
  shipped.get("manifest.json")?.toString("utf8") || fail("missing manifest.json"),
) as { version: string };
if (shippedManifest.version !== sourceManifest.version) {
  fail(`archive version ${shippedManifest.version} != source ${sourceManifest.version}`);
}

console.log(
  `verify-extension-zip: OK (version=${metadata.version} files=${source.length} bytes=${zip.length})`,
);
