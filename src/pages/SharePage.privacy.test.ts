import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSharePageSource() {
  return readFileSync(
    resolve(process.cwd(), "src/pages/SharePage.tsx"),
    "utf8",
  );
}

describe("SharePage crawler metadata", () => {
  it("uses generic metadata that never includes the share token", () => {
    const source = readSharePageSource();

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
    const source = readSharePageSource();
    const onUnlockAt = source.indexOf("const onUnlock = async");
    const headAt = source.indexOf("const head =", onUnlockAt);
    const onUnlock = source.slice(onUnlockAt, headAt);

    expect(source).toContain("const requestGeneration = useRef(0);");
    expect(source).toContain("const committedTargetRef = useRef");
    expect(source).not.toContain("currentShareToken");
    expect(source).toContain('state.token !== token || state.targetHash !== currentHash');
    expect(source).toMatch(
      /useLayoutEffect[\s\S]*committedTargetRef\.current = \{ token, targetHash: currentHash \}/,
    );
    expect(onUnlock).toMatch(
      /state\.kind !== "needs-key"[\s\S]*const lockedState = state;[\s\S]*const generation = lockedState\.generation;[\s\S]*const requestToken = lockedState\.token;[\s\S]*const requestHash = lockedState\.targetHash;/,
    );
    expect(onUnlock).toMatch(
      /await decryptBytes[\s\S]*if \(!isCurrentRequest\(generation, requestToken, requestHash\)\) return;[\s\S]*setState\(\{ kind: "ready"/,
    );
    expect(onUnlock).toMatch(
      /catch[\s\S]*if \(!isCurrentRequest\(generation, requestToken, requestHash\)\) return;[\s\S]*setState\(\{ kind: "error"/,
    );
  });

  it("updates commit-sensitive async refs only from layout effects", () => {
    const shareSource = readSharePageSource();
    const unlockSource = readFileSync(
      resolve(process.cwd(), "src/components/note/UnlockForm.tsx"),
      "utf8",
    );

    expect(shareSource).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*committedTargetRef\.current =/,
    );
    expect(unlockSource).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*onUnlockRef\.current = onUnlock;/,
    );
    expect(unlockSource).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*targetRef\.current = \{ slug, salt, check, iterations \}/,
    );
  });
});
