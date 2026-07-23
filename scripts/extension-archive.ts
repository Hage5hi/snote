import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type ExtensionArchiveEntry = {
  path: string;
  data: Buffer;
};

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const DOS_DATE_1980_01_01 = 0x0021;

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0
      ? 0xedb88320 ^ (value >>> 1)
      : value >>> 1;
  }
  return value >>> 0;
});

function comparePaths(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPackageFile(relativePath: string) {
  const segments = relativePath.split("/");
  if (segments.includes("__tests__")) return false;
  if (/^RELEASE_NOTES_\d+\.\d+\.\d+\.md$/.test(relativePath)) return false;
  return true;
}

export function collectExtensionPackageEntries(
  repositoryRoot = process.cwd(),
): ExtensionArchiveEntry[] {
  const extensionRoot = resolve(repositoryRoot, "chrome-extension");
  const paths: string[] = [];

  function visit(directory: string) {
    const children = readdirSync(directory).sort(comparePaths);
    for (const child of children) {
      const absolutePath = join(directory, child);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        if (child !== "__tests__") visit(absolutePath);
        continue;
      }
      if (!stats.isFile()) continue;
      const archivePath = relative(extensionRoot, absolutePath)
        .split(sep)
        .join("/");
      if (isPackageFile(archivePath)) paths.push(archivePath);
    }
  }

  visit(extensionRoot);
  return paths
    .sort(comparePaths)
    .map((archivePath) => ({
      path: archivePath,
      data: readFileSync(join(extensionRoot, ...archivePath.split("/"))),
    }));
}

function validateEntryPath(path: string) {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error(`unsafe extension archive path: ${JSON.stringify(path)}`);
  }
}

export function buildDeterministicZip(entries: ExtensionArchiveEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  const seen = new Set<string>();

  for (const entry of [...entries].sort((a, b) => comparePaths(a.path, b.path))) {
    validateEntryPath(entry.path);
    if (seen.has(entry.path)) throw new Error(`duplicate extension archive path: ${entry.path}`);
    seen.add(entry.path);

    const name = Buffer.from(entry.path, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(DEFLATE_METHOD, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(DEFLATE_METHOD, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + compressed.length;
  }

  if (seen.size > 0xffff) throw new Error("extension archive has too many entries");
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(seen.size, 8);
  end.writeUInt16LE(seen.size, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(zip: Buffer) {
  const minimumOffset = Math.max(0, zip.length - 22 - 0xffff);
  for (let offset = zip.length - 22; offset >= minimumOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("extension archive is missing its central directory");
}

export function readZipEntries(zip: Buffer) {
  const endOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  let centralOffset = zip.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(centralOffset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`invalid central directory entry ${index}`);
    }
    const method = zip.readUInt16LE(centralOffset + 10);
    const checksum = zip.readUInt32LE(centralOffset + 16);
    const compressedSize = zip.readUInt32LE(centralOffset + 20);
    const uncompressedSize = zip.readUInt32LE(centralOffset + 24);
    const nameLength = zip.readUInt16LE(centralOffset + 28);
    const extraLength = zip.readUInt16LE(centralOffset + 30);
    const commentLength = zip.readUInt16LE(centralOffset + 32);
    const localOffset = zip.readUInt32LE(centralOffset + 42);
    const path = zip
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8");

    validateEntryPath(path);
    if (entries.has(path)) throw new Error(`duplicate extension archive path: ${path}`);
    if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`invalid local header for ${path}`);
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === DEFLATE_METHOD
      ? inflateRawSync(compressed)
      : method === 0
        ? Buffer.from(compressed)
        : (() => {
            throw new Error(`unsupported ZIP method ${method} for ${path}`);
          })();

    if (data.length !== uncompressedSize || crc32(data) !== checksum) {
      throw new Error(`corrupt extension archive entry: ${path}`);
    }
    entries.set(path, data);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
