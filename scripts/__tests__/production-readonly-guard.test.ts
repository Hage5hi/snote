import { describe, expect, it } from "vitest";
import { shouldBlockProductionRequest } from "../../e2e/helpers/production-readonly";

describe("production read-only smoke guard", () => {
  it.each([
    ["GET", "https://note.syrin.online/privacy", false],
    ["GET", "https://note.syrin.online/~api/analytics", true],
    ["GET", "https://note.syrin.online/~api/analytics/events", true],
    ["GET", "https://note.syrin.online/~flock.js", true],
    ["GET", "https://note.syrin.online/%7eapi%2fanalytics", true],
    ["GET", "https://note.syrin.online/%257eapi%252fanalytics", true],
    ["GET", "https://note.syrin.online/api%2fnotes", true],
    ["GET", "https://note.syrin.online/%E0%A4%A", true],
    ["POST", "https://note.syrin.online/privacy", true],
    ["GET", "https://example.supabase.co/rest/v1/notes", true],
  ])("blocks=%s %s", (method, url, expected) => {
    expect(shouldBlockProductionRequest(url, method)).toBe(expected);
  });
});
