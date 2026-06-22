// Unit tests for redact.js. One block per REDACTION_RULES entry plus the
// helpers. Each case is an explicit { input, expected } (or matcher) pair
// so any change that weakens a rule flips an assertion.
import { describe, it, expect } from "vitest";
import {
  REDACTION_RULES,
  maskToken,
  redactUrl,
  redactLine,
  redactPayload,
} from "../lib/redact.js";

const ruleByName = Object.fromEntries(REDACTION_RULES.map((r) => [r.name, r]));

function apply(name, input) {
  const r = ruleByName[name];
  if (!r) throw new Error(`unknown rule ${name}`);
  return String(input).replace(r.pattern, r.replace);
}

describe("maskToken", () => {
  it.each([
    ["", "•••"],
    ["a", "•••"],
    ["ab", "•••"],
    ["abc", "a•••c"],
    ["my-secret-note-slug", "m•••g"],
  ])("masks %j -> %j", (input, expected) => {
    expect(maskToken(input)).toBe(expected);
  });
  it("handles null/undefined", () => {
    expect(maskToken(null)).toBe("");
    expect(maskToken(undefined)).toBe("");
  });
});

describe("redactUrl", () => {
  it.each([
    ["https://note.syrin.online/n/abc?token=xyz", "https://note.syrin.online/…"],
    ["http://localhost:8080/x", "http://localhost:8080/…"],
    ["not-a-url", "<url>"],
  ])("%s -> %s", (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });
});

describe("rule: url", () => {
  it("strips path/query/hash", () => {
    expect(apply("url", "see https://note.syrin.online/n/abc?token=xyz#h ok")).toBe(
      "see https://note.syrin.online/… ok",
    );
  });
  it("does not touch plain text", () => {
    expect(apply("url", "no urls here")).toBe("no urls here");
  });
});

describe("rule: email", () => {
  it.each([
    ["user alice@example.com hi", "user <email> hi"],
    ["a.b+tag@sub.example.co.uk", "<email>"],
  ])("%s -> %s", (i, e) => expect(apply("email", i)).toBe(e));
  it("ignores @handle without dot/tld", () => {
    expect(apply("email", "@alice")).toBe("@alice");
  });
});

describe("rule: jwt", () => {
  it("masks 3-segment base64url tokens", () => {
    expect(apply("jwt", "tok eyJhbGciOi.JzdWIiOiIx.SflKxwRJSM go")).toBe("tok <jwt> go");
  });
  it("does not match 2-segment", () => {
    expect(apply("jwt", "eyJabc.def")).toBe("eyJabc.def");
  });
});

describe("rule: bearer", () => {
  it.each([
    ["Authorization: Bearer abc123xyz", "Bearer=<redacted>"],
    ["token=hunter2", "token=<redacted>"],
    ["apikey: SECRETVAL", "apikey=<redacted>"],
    ["api_key = AKIA", "api_key=<redacted>"],
    ["password: hunter2", "password=<redacted>"],
  ])("%s -> %s", (i, e) => expect(apply("bearer", i)).toBe(e));
});

describe("rule: api-key-prefixed", () => {
  it.each([
    "sk_live_ABCDEFGHIJKLMNOPQRSTUVWX",
    "pk_test_ABCDEFGHIJKLMNOPQRSTUVWX",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWX1234",
    "AIzaSyA-ABCDEFGHIJKLMNOPQRSTUV",
    "AKIAIOSFODNN7EXAMPLE12345",
  ])("masks %s", (key) => {
    expect(apply("api-key-prefixed", `key=${key} end`)).toBe("key=<api-key> end");
  });
  it("does not match short prefixes", () => {
    expect(apply("api-key-prefixed", "sk_short")).toBe("sk_short");
  });
});

describe("rule: uuid", () => {
  it("masks v4-shaped uuids", () => {
    expect(apply("uuid", "id=11111111-2222-3333-4444-555555555555.")).toBe("id=<uuid>.");
  });
  it("ignores non-uuid hex", () => {
    expect(apply("uuid", "11111111-2222")).toBe("11111111-2222");
  });
});

describe("rule: fs-path", () => {
  it.each([
    ["/Users/alice/notes", "<path>"],
    ["/home/bob/file", "<path>/file"], // path rule eats user dir; rest remains
    ["C:\\Users\\bob\\x", "<path>\\x"],
  ])("%s -> %s", (i, e) => expect(apply("fs-path", i)).toBe(e));
});

describe("rule: username-at", () => {
  it("masks @handle with leading space", () => {
    expect(apply("username-at", "hi @alice there")).toBe("hi @<user> there");
  });
  it("masks at start of string", () => {
    expect(apply("username-at", "@bob_dev hi")).toBe("@<user> hi");
  });
});

describe("rule: labeled-slug", () => {
  it.each([
    ["ack sent my-secret-note-slug", "ack sent m•••g"],
    ["storage write ok abcdef", "storage write ok a•••f"],
    ["lastSlug: xy", "lastSlug: •••"],
  ])("%s -> %s", (i, e) => expect(apply("labeled-slug", i)).toBe(e));
});

describe("rule: long-token", () => {
  it("masks 32+ char opaque tokens", () => {
    const t = "a".repeat(40);
    expect(apply("long-token", `t=${t}`)).toBe("t=a•••a");
  });
  it("ignores short words", () => {
    expect(apply("long-token", "short")).toBe("short");
  });
});

describe("redactLine pipeline", () => {
  it("composes rules in order", () => {
    const out = redactLine(
      "user alice@example.com hit https://x.com/p?k=v with token=ABC123",
    );
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("/p?k=v");
    expect(out).not.toContain("ABC123");
    expect(out).toContain("<email>");
    expect(out).toContain("https://x.com/…");
    expect(out).toContain("token=<redacted>");
  });
});

describe("redactPayload", () => {
  const raw = {
    kind: "syrin-note-debug-log",
    version: 1,
    extensionVersion: "9.9.9",
    exportedAt: "2026-06-21T00:00:00.000Z",
    lastSlug: "my-secret-note-slug",
    iframeSrc: "https://note.syrin.online/n/abc?token=xyz",
    lines: [
      { t: 1, msg: "ack sent my-secret-note-slug" },
      { t: 2, msg: "user alice@example.com" },
    ],
  };
  const out = redactPayload(raw);

  it("sets redacted=true", () => expect(out.redacted).toBe(true));
  it("masks lastSlug", () => expect(out.lastSlug).toBe("m•••g"));
  it("reduces iframeSrc to origin", () =>
    expect(out.iframeSrc).toBe("https://note.syrin.online/…"));
  it("redacts every line.msg", () => {
    expect(out.lines[0].msg).not.toContain("my-secret-note-slug");
    expect(out.lines[1].msg).not.toContain("alice@example.com");
  });
  it("handles null lastSlug/iframeSrc", () => {
    const o = redactPayload({ ...raw, lastSlug: null, iframeSrc: null, lines: [] });
    expect(o.lastSlug).toBeNull();
    expect(o.iframeSrc).toBeNull();
  });
});
