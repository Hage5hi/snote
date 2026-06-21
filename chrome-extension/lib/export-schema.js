// Strict schema for the debug-log export JSON. Both redacted and
// non-redacted exports must validate against this — guarantees consumers
// (bug-report intake, CI, support) always see the same shape.
//
// We hand-roll a tiny validator instead of pulling Ajv into the extension
// bundle: keeps the MV3 zip small and avoids new supply-chain surface for
// what is ultimately a fixed shape.

export const EXPORT_KIND = "syrin-note-debug-log";
export const EXPORT_VERSION = 1;

// Field definitions: type + whether required + extra check.
const FIELDS = {
  kind: { type: "string", const: EXPORT_KIND },
  version: { type: "number", const: EXPORT_VERSION },
  extensionVersion: { type: "string" },
  exportedAt: {
    type: "string",
    check: (v) => !Number.isNaN(Date.parse(v)) || "exportedAt must be ISO-8601",
  },
  lastSlug: { type: ["string", "null"] },
  iframeSrc: { type: ["string", "null"] },
  redacted: { type: "boolean", optional: true },
  lines: {
    type: "array",
    check: (v) => {
      for (let i = 0; i < v.length; i++) {
        const l = v[i];
        if (!l || typeof l !== "object") return `lines[${i}] not object`;
        if (typeof l.t !== "number") return `lines[${i}].t not number`;
        if (typeof l.msg !== "string") return `lines[${i}].msg not string`;
      }
      return true;
    },
  },
};

function typeOk(value, type) {
  const types = Array.isArray(type) ? type : [type];
  for (const t of types) {
    if (t === "null" && value === null) return true;
    if (t === "array" && Array.isArray(value)) return true;
    if (t !== "null" && t !== "array" && typeof value === t) return true;
  }
  return false;
}

export function validateExport(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["payload not an object"] };
  }
  for (const [key, spec] of Object.entries(FIELDS)) {
    const present = key in payload;
    if (!present) {
      if (!spec.optional) errors.push(`missing field: ${key}`);
      continue;
    }
    const v = payload[key];
    if (!typeOk(v, spec.type)) {
      errors.push(`field ${key}: wrong type (got ${v === null ? "null" : typeof v})`);
      continue;
    }
    if (spec.const !== undefined && v !== spec.const) {
      errors.push(`field ${key}: must equal ${JSON.stringify(spec.const)}`);
    }
    if (spec.check) {
      const r = spec.check(v);
      if (r !== true) errors.push(`field ${key}: ${r}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Filename contract — kept here so tests can assert exporter and validator
// agree on the naming scheme.
export function expectedFilename({ redacted, isoTimestamp }) {
  const safeTs = String(isoTimestamp).replace(/[:.]/g, "-");
  return `syrin-note-debug${redacted ? "-redacted" : ""}-${safeTs}.json`;
}

export function isExpectedFilename(name) {
  return /^syrin-note-debug(-redacted)?-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z\.json$/.test(
    String(name),
  );
}
