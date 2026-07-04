// GENERATED FILE — do not edit by hand.
// Regenerate with: bun run scripts/generate-focus-trap-schema-types.ts
// Source of truth:
//   - schemas/focus-trap-inspect-report.schema.json
//   - schemas/focus-trap-inspect-diff.schema.json
// CI asserts `git diff --exit-code` on this file after regeneration.

export type FocusTrapInspectReport = {
  "artifacts": Array<{
    "failureKind": string | null;
    "failureReason": string;
    "file": string;
    "quarantined": string;
    "schemaPointer": string | null;
    [key: string]: unknown;
  }>;
  "generatedAt": string;
  "invalid": number;
  "invalidDir"?: string | null;
  "issues": Array<{
    "failureKind": string | null;
    "failureReason": string;
    "file": string;
    "parseError"?: string | null;
    "quarantined"?: string;
    "schemaPointer"?: string | null;
    [key: string]: unknown;
  }>;
  "matched": number;
  "meta": {
    "argv": Array<string>;
    "ciRunAttempt"?: string | null;
    "ciRunId"?: string | null;
    "gitSha": string | null;
    "invalidDir"?: string | null;
    "scanRoot": string;
    "timestamp": string;
    [key: string]: unknown;
  };
  "scanned": number;
  "schemaVersion": "1.0.0";
  "valid": number;
  [key: string]: unknown;
};

export type FocusTrapInspectDiff = {
  "changed": number;
  "diffWith": string;
  "generatedAt": string;
  "meta": {
    "argv": Array<string>;
    "ciRunAttempt"?: string | null;
    "ciRunId"?: string | null;
    "gitSha": string | null;
    "invalidDir"?: string | null;
    "scanRoot": string;
    "timestamp": string;
    [key: string]: unknown;
  };
  "rows": Array<{
    "currFailureReason": string;
    "currSchemaPointer": string;
    "file": string;
    "prevFailureReason": string;
    "prevSchemaPointer": string;
  }>;
  "schemaVersion": "1.0.0";
  [key: string]: unknown;
};
