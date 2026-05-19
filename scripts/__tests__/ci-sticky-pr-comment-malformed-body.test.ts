// Regression: a prior sticky comment exists (marker matches) but its
// body is malformed — e.g. truncated mid-section, missing one of the
// named sections, or with stale/extra junk appended by an earlier bug.
// The next rerun must REPLACE the body wholesale (last-write-wins),
// not append on top of it. After upsert the comment must contain
// exactly one of each section, equal to the freshly-built body.
import { describe, expect, it, vi } from "vitest";
import { buildCoverageComment } from "../ci-build-coverage-pr-comment";

const HEADER = "i18n-cli-coverage";
const MARKER = `<!-- Sticky Pull Request Comment${HEADER} -->`;
const RUN = "https://github.com/o/r/actions/runs/55";

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
    c.body = `${MARKER}\n${body}`; // REPLACE — not append.
    return c;
  });
  const upsert = async (body: string) => {
    const prior = comments.find((c) => c.body.startsWith(MARKER));
    if (prior) return update(prior.id, body);
    return create(body);
  };
  return { comments, create, update, upsert };
}

const countOccurrences = (haystack: string, needle: string) =>
  (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

const buildFresh = () =>
  buildCoverageComment({
    runUrl: RUN,
    validateOutcome: "success",
    coverageArtifactId: "cov-NEW",
    debugBundleArtifactId: "deb-NEW",
    stepSummaryArtifactId: "step-NEW",
    failureBreakdownArtifactId: "fb-NEW",
  });

describe("sticky PR comment — malformed prior body is REPLACED, not appended", () => {
  const MALFORMED_BODIES: Array<[string, string]> = [
    [
      "truncated mid-section",
      `${MARKER}\n### i18n CLI test coverage\n\n- [📊 HTML coverage report](${RUN}/artifacts/cov-OLD) — open\n#### Debugging artifa`,
    ],
    [
      "missing Per-OS matrix section",
      `${MARKER}\n### i18n CLI test coverage\n\n#### Debugging artifacts\n- old bullet\n`,
    ],
    [
      "duplicated sections from a prior append-bug",
      `${MARKER}\n### i18n CLI test coverage\n#### Debugging artifacts\n#### Debugging artifacts\n#### Per-OS matrix artifacts\n#### Per-OS matrix artifacts\nstale junk\n`,
    ],
    [
      "extra trailing junk after a valid body",
      `${MARKER}\n### i18n CLI test coverage\n#### Debugging artifacts\n#### Per-OS matrix artifacts\n<!-- leftover -->\nrogue text\n`,
    ],
  ];

  it.each(MALFORMED_BODIES)("malformed=%s: next rerun replaces wholesale", async (_label, malformed) => {
    const api = makeApi([{ id: 7, body: malformed }]);
    const fresh = buildFresh();
    await api.upsert(fresh);

    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.comments).toHaveLength(1);

    const body = api.comments[0].body;
    // Exactly one marker, exactly one of each section — no stacking.
    expect(countOccurrences(body, MARKER)).toBe(1);
    expect(countOccurrences(body, "### i18n CLI test coverage")).toBe(1);
    expect(countOccurrences(body, "#### Debugging artifacts")).toBe(1);
    expect(countOccurrences(body, "#### Per-OS matrix artifacts")).toBe(1);
    // Body after the marker is byte-equal to the freshly built body.
    expect(body.slice(MARKER.length + 1)).toBe(fresh);
    // Old artifact ids are gone; new ones present.
    expect(body).not.toContain("cov-OLD");
    expect(body).toContain(`${RUN}/artifacts/cov-NEW`);
    // No leftover junk from any malformed prior body.
    expect(body).not.toContain("rogue text");
    expect(body).not.toContain("stale junk");
    expect(body).not.toContain("<!-- leftover -->");
  });
});
