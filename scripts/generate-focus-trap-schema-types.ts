// Deterministic, dependency-free TypeScript type generator for the
// two published JSON Schemas under schemas/. Runs in CI (`git diff
// --exit-code`) to keep schemas/ and the generated .d.ts in lockstep,
// so code and tests can `import type` the pinned artifact shapes
// instead of duplicating them (which drifts silently).
//
// Scope: covers the exact schema constructs used by
// focus-trap-inspect-report/diff schemas today — object (with
// required + properties), array, string, number/integer, null, and
// `const` string literals. Extend as new constructs appear.
import { readFileSync, writeFileSync } from "node:fs";

type Schema = Record<string, unknown>;

function renderType(s: Schema, indent = ""): string {
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (Array.isArray(s.type)) {
    return s.type.map((t) => renderType({ ...s, type: t }, indent)).join(" | ");
  }
  const t = s.type as string | undefined;
  if (t === "string") return "string";
  if (t === "number" || t === "integer") return "number";
  if (t === "boolean") return "boolean";
  if (t === "null") return "null";
  if (t === "array") {
    const items = (s.items as Schema | undefined) ?? {};
    return `Array<${renderType(items, indent)}>`;
  }
  if (t === "object" || s.properties) {
    const props = (s.properties as Record<string, Schema> | undefined) ?? {};
    const required = new Set((s.required as string[] | undefined) ?? []);
    const keys = Object.keys(props).sort(); // deterministic
    const inner = indent + "  ";
    const lines = keys.map((k) => `${inner}${JSON.stringify(k)}${required.has(k) ? "" : "?"}: ${renderType(props[k], inner)};`);
    if (s.additionalProperties !== false) lines.push(`${inner}[key: string]: unknown;`);
    return `{\n${lines.join("\n")}\n${indent}}`;
  }
  return "unknown";
}

function generate(schemaPath: string, typeName: string): string {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Schema;
  const body = renderType(schema);
  return `export type ${typeName} = ${body};\n`;
}

const OUT = "scripts/_helpers/focus-trap-inspect-schema.types.gen.ts";

const header = `// GENERATED FILE — do not edit by hand.
// Regenerate with: bun run scripts/generate-focus-trap-schema-types.ts
// Source of truth:
//   - schemas/focus-trap-inspect-report.schema.json
//   - schemas/focus-trap-inspect-diff.schema.json
// CI asserts \`git diff --exit-code\` on this file after regeneration.

`;

const body =
  generate("schemas/focus-trap-inspect-report.schema.json", "FocusTrapInspectReport") +
  "\n" +
  generate("schemas/focus-trap-inspect-diff.schema.json", "FocusTrapInspectDiff");

writeFileSync(OUT, header + body);
console.log(`wrote ${OUT}`);
