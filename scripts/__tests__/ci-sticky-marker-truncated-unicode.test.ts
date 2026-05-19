// Adversarial: the sticky marker line may arrive truncated (network
// glitch, manual edit, copy-paste accident) or surrounded by unusual
// Unicode whitespace (NBSP, em-space, zero-width joiners, BOM, etc.).
//
// Contract:
//   - hasStickyMarker MUST tolerate exotic ws characters around the
//     marker and still match.
//   - It MUST NOT falsely match a truncated marker (a partial prefix
//     is NOT the marker — we'd rather post a fresh comment than
//     silently overwrite the wrong one).
//   - upsert MUST behave correctly in both cases: update on real
//     match, create when the marker is corrupt/truncated.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";
import { hasStickyMarker } from "./ci-sticky-marker-detection-whitespace.test";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/55";

// Exotic Unicode whitespace characters worth pinning explicitly.
const NBSP = "\u00A0";
const EM_SP = "\u2003";
const EN_SP = "\u2002";
const THIN_SP = "\u2009";
const ZWSP = "\u200B"; // zero-width space — NOT whitespace per trim()
const ZWJ = "\u200D";  // zero-width joiner — NOT whitespace
const BOM = "\uFEFF";
const IDEO_SP = "\u3000"; // ideographic space

interface Comment { id: number; body: string }
function makeApi(seed: Comment[]) {
  const comments = seed.map((c) => ({ ...c }));
  let nextId = comments.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const create = vi.fn(async (body: string) => {
    const c = { id: nextId++, body: `${MARKER}\n${body}` };
    comments.push(c);
    return c;
  });
  const update = vi.fn(async (id: number, body: string) => {
    const c = comments.find((x) => x.id === id)!;
    c.body = `${MARKER}\n${body}`;
    return c;
  });
  const upsert = async (body: string) => {
    const match = comments.find((c) => hasStickyMarker(c.body));
    return match ? update(match.id, body) : create(body);
  };
  return { comments, create, update, upsert };
}

const fresh = () =>
  buildCoverageComment({
    runUrl: RUN,
    validateOutcome: "success",
    coverageArtifactId: "cov",
    debugBundleArtifactId: "deb",
    stepSummaryArtifactId: "step",
    failureBreakdownArtifactId: "fb",
  });

describe("sticky marker — unusual Unicode whitespace tolerance", () => {
  it.each([
    ["NBSP padding", `${NBSP}${NBSP}${MARKER}${NBSP}\nbody`],
    ["em-space padding", `${EM_SP}${MARKER}${EM_SP}\nbody`],
    ["en-space padding", `${EN_SP}${MARKER}${EN_SP}\nbody`],
    ["thin-space padding", `${THIN_SP}${MARKER}${THIN_SP}\nbody`],
    ["ideographic-space padding", `${IDEO_SP}${MARKER}${IDEO_SP}\nbody`],
    ["BOM + tab + marker + spaces", `${BOM}\t${MARKER}   \nbody`],
    ["mixed exotic ws", `${NBSP}${EM_SP}\t${MARKER}${THIN_SP}${NBSP}\nbody`],
  ])("matches with %s", (_label, body) => {
    let r: unknown;
    expect(() => { r = hasStickyMarker(body); }).not.toThrow();
    expect(r).toBe(true);
  });

  it.each([
    ["ZWSP inside marker", MARKER.slice(0, 10) + ZWSP + MARKER.slice(10) + "\nbody"],
    ["ZWJ inside marker", MARKER.slice(0, 20) + ZWJ + MARKER.slice(20) + "\nbody"],
  ])("does NOT match when zero-width chars are injected INSIDE the marker: %s", (_label, body) => {
    // Zero-width chars inside the literal marker break the byte
    // equality on the trimmed line. We'd rather miss than overwrite
    // the wrong comment, so this returning false is correct.
    expect(() => hasStickyMarker(body)).not.toThrow();
    expect(hasStickyMarker(body)).toBe(false);
  });
});

describe("sticky marker — truncated marker safety", () => {
  it.each([
    ["truncated head", MARKER.slice(0, MARKER.length - 5) + "\nbody"],
    ["truncated tail", MARKER.slice(5) + "\nbody"],
    ["missing closing -->", MARKER.replace(" -->", "") + "\nbody"],
    ["missing opening <!--", MARKER.replace("<!-- ", "") + "\nbody"],
    ["partial header text", `<!-- Sticky Pull Request Commenti18n -->\nbody`],
    ["empty marker line", `\nbody`],
  ])("does NOT match truncated marker: %s", (_label, body) => {
    let r: unknown;
    expect(() => { r = hasStickyMarker(body); }).not.toThrow();
    expect(r).toBe(false);
  });

  it("upsert CREATES a fresh comment when prior body has a truncated marker", async () => {
    const api = makeApi([
      { id: 1, body: MARKER.slice(0, -4) + "\nold (truncated marker, not sticky)" },
    ]);
    await api.upsert(fresh());
    // Truncated marker is not detected → a fresh sticky comment is
    // created rather than silently overwriting the wrong one.
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.comments).toHaveLength(2);
    const sticky = api.comments.filter((c) => c.body.startsWith(MARKER));
    expect(sticky).toHaveLength(1);
  });

  it("upsert UPDATES in place when prior body has exotic-ws-padded marker", async () => {
    const api = makeApi([
      { id: 1, body: `${NBSP}${EM_SP}${MARKER}${THIN_SP}\nold body` },
    ]);
    await api.upsert(fresh());
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith(1, expect.stringContaining(RUN));
    expect(api.comments).toHaveLength(1);
  });
});
