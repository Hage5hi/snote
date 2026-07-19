import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("SharePage crawler metadata", () => {
  it("uses generic metadata that never includes the share token", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./SharePage.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain(
      'const SHARE_CANONICAL_URL = "https://note.syrin.online/s";',
    );
    expect(source).toContain(
      'const SHARE_ROBOTS = "noindex,nofollow,noarchive,nosnippet";',
    );
    expect(source).not.toContain("snote.lovable.app");
    expect(source).not.toMatch(/(?:canonical|og:url)[^\n]*\$\{token\}/);
  });

  it("rejects stale manual decrypt results after the share token changes", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./SharePage.tsx", import.meta.url)),
      "utf8",
    );
    const onUnlockAt = source.indexOf("const onUnlock = async");
    const headAt = source.indexOf("const head =", onUnlockAt);
    const onUnlock = source.slice(onUnlockAt, headAt);

    expect(source).toContain("const requestGeneration = useRef(0);");
    expect(source).toContain("const currentShareToken = useRef(token);");
    expect(source).toContain("currentShareToken.current = token;");
    expect(source).toContain('state.token !== token');
    expect(source).toMatch(
      /const isCurrentRequest[\s\S]*currentShareToken\.current === requestToken/,
    );
    expect(onUnlock).toMatch(
      /const generation = requestGeneration\.current;[\s\S]*const requestToken = token;/,
    );
    expect(onUnlock).toMatch(
      /await decryptBytes[\s\S]*if \(!isCurrentRequest\(generation, requestToken\)\) return;[\s\S]*setState\(\{ kind: "ready"/,
    );
    expect(onUnlock).toMatch(
      /catch[\s\S]*if \(!isCurrentRequest\(generation, requestToken\)\) return;[\s\S]*setState\(\{ kind: "error"/,
    );
  });
});
