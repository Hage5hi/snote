// Unit tests for redact.js. One block per REDACTION_RULES entry plus the
// helpers. Each case is an explicit { input, expected } (or matcher) pair
// so any change that weakens a rule flips an assertion.
import { describe, it, expect, vi } from "vitest";
import * as redactModule from "../lib/redact.js";
import {
  REDACTION_RULES,
  maskToken,
  redactUrl,
  redactLine,
  redactPayload,
} from "../lib/redact.js";
import {
  validateDiagnostics,
  DIAGNOSTICS_KIND,
  DIAGNOSTICS_SCHEMA_VERSION,
} from "../lib/diagnostics-schema.js";

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

  it.each([
    ["https://note.syrin.online/", "root"],
    ["https://note.syrin.online/my-private-slug?x=1", "note"],
    ["https://note.syrin.online/s/private-token", "share"],
  ])("summarizes %s with only its origin and route class", (input, route) => {
    expect(redactModule.summarizeUrlForDiagnostics(input)).toBe(
      `${redactUrl(input)} route=${route}`,
    );
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
    ["Authorization: bearer=abc123xyz", "Authorization: bearer=<redacted>"],
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
    ["/Users/alice/notes", "<path>/notes"],
    ["/home/bob/file", "<path>/file"],
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
      { t: 3, msg: "runtime detail unlabeled-secret" },
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
    expect(out.lines[2].msg).not.toContain("unlabeled-secret");
  });
  it("handles null lastSlug/iframeSrc", () => {
    const o = redactPayload({ ...raw, lastSlug: null, iframeSrc: null, lines: [] });
    expect(o.lastSlug).toBeNull();
    expect(o.iframeSrc).toBeNull();
  });
});

describe("diagnostics locator containment", () => {
  const slug = "sentinel-private-note-slug";
  const token = "sentinel-share-token-123";
  const iframeSrc = `https://note.syrin.online/s/${token}/nested/${slug}?token=${token}`;

  it("keeps raw locators out of console and the in-memory debug snapshot", async () => {
    const { dlog, setDebug, snapshotDebugLog } = await import("../lib/debug.js");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    setDebug(true);

    const slugSummary = redactModule.summarizeSlugForDiagnostics?.(slug) ?? slug;
    const urlSummary = redactModule.summarizeUrlForDiagnostics?.(iframeSrc) ?? iframeSrc;
    dlog("ack sent", slugSummary);
    dlog("loading", urlSummary);

    const serialized = JSON.stringify({
      console: consoleLog.mock.calls,
      lines: snapshotDebugLog().slice(-2),
    });
    expect(serialized).not.toContain(slug);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(`/s/${token}`);
    expect(serialized).toContain("slugLength=");
    expect(serialized).toContain("https://note.syrin.online/");
    consoleLog.mockRestore();
  });

  it("sanitizes the complete serialized diagnostics bundle without breaking its schema", () => {
    const sentinels = {
      build: "sentinel-app-build-id",
      mismatch: "sentinel-version-mismatch-reason",
      timeline: "sentinel-timeline-detail",
      telemetryBuild: "sentinel-telemetry-build-id",
      telemetryDetail: "sentinel-telemetry-detail",
      csp: "frame-ancestors 'self'; report-uri /sentinel-csp-path",
      cspReason: "sentinel-csp-reason",
      reachable: "sentinel-reachability-error",
    };
    const raw = {
      kind: DIAGNOSTICS_KIND,
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      at: "2026-07-20T00:00:00.000Z",
      extensionVersion: "1.3.6",
      handshake: {
        extensionProtocol: 2,
        appProtocol: 2,
        appBuildId: sentinels.build,
        ready: true,
        versionMismatch: sentinels.mismatch,
      },
      load: {
        iframeSrc,
        iframeLoaded: true,
        retryCount: 0,
        appReachable: sentinels.reachable,
      },
      cspFrameAncestors: {
        inspected: true,
        ok: false,
        csp: sentinels.csp,
        reason: sentinels.cspReason,
      },
      messageTimeline: [
        {
          t: 3,
          kind: "ready",
          detail: {
            protocol: 2,
            len: slug.length,
            buildId: sentinels.timeline,
            nested: { value: sentinels.timeline },
          },
        },
      ],
      telemetry: [
        {
          t: 4,
          event: "handshake-ok",
          extVersion: "1.3.5",
          appBuildId: sentinels.telemetryBuild,
          retryCount: 0,
          detail: {
            appProtocol: 2,
            appVersion: sentinels.telemetryDetail,
            nested: [sentinels.telemetryDetail],
          },
        },
      ],
      telemetryEnabled: true,
      debugLines: [
        { t: 1, msg: `ack sent ${slug}` },
        { t: 2, msg: `loading ${iframeSrc}` },
      ],
    };
    const sanitize = redactModule.redactDiagnosticsBundle ?? ((bundle) => bundle);
    const output = sanitize(raw);
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain(slug);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(`/s/${token}`);
    expect(serialized).not.toContain(new URL(iframeSrc).pathname);
    for (const sentinel of Object.values(sentinels)) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(output.load.iframeSrc).toBe(redactUrl(iframeSrc));
    expect(output.load.appReachable).toBe("unknown");
    expect(output.handshake.appBuildId).toBe("<redacted>");
    expect(output.handshake.versionMismatch).toBe("protocol-mismatch");
    expect(output.messageTimeline[0].kind).toBe("ready");
    expect(output.messageTimeline[0].detail.protocol).toBe(2);
    expect(output.messageTimeline[0].detail.len).toBe(slug.length);
    expect(output.telemetry[0].event).toBe("handshake-ok");
    expect(output.telemetry[0].retryCount).toBe(0);
    expect(output.telemetry[0].detail.appProtocol).toBe(2);
    expect(output.cspFrameAncestors).toEqual({
      inspected: true,
      ok: false,
      csp: "<redacted>",
      reason: "unknown",
    });
    expect(output.debugLines).toHaveLength(2);
    expect(validateDiagnostics(output)).toEqual({ ok: true, errors: [] });
  });

  it("preserves browser-owned network state and never invents CSP inspection", () => {
    const output = redactModule.redactDiagnosticsBundle({
      kind: DIAGNOSTICS_KIND,
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      at: "2026-07-20T00:00:00.000Z",
      extensionVersion: "1.3.6",
      handshake: {},
      load: { appReachable: "offline" },
      cspFrameAncestors: {
        inspected: false,
        ok: null,
        csp: "must-not-survive",
        reason: "not-inspected",
      },
      messageTimeline: [],
      telemetry: [],
      telemetryEnabled: false,
      debugLines: [],
    });

    expect(output.load.appReachable).toBe("offline");
    expect(output.cspFrameAncestors).toEqual({
      inspected: false,
      ok: null,
      csp: null,
      reason: "not-inspected",
    });
    expect(validateDiagnostics(output)).toEqual({ ok: true, errors: [] });
  });

  it("caps version-shaped strings before diagnostics export", () => {
    const oversizedVersion = `1.0.0-${"a".repeat(59)}`;
    const output = redactModule.redactDiagnosticsBundle({
      kind: DIAGNOSTICS_KIND,
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      at: "2026-07-20T00:00:00.000Z",
      extensionVersion: oversizedVersion,
      handshake: {},
      load: {},
      cspFrameAncestors: {},
      messageTimeline: [],
      telemetry: [{ detail: { appVersion: oversizedVersion } }],
      telemetryEnabled: true,
      debugLines: [],
    });

    expect(oversizedVersion).toHaveLength(65);
    expect(output.extensionVersion).toBe("unknown");
    expect(output.telemetry[0].detail.appVersion).toBe("unknown");
    expect(JSON.stringify(output)).not.toContain(oversizedVersion);
  });
});
