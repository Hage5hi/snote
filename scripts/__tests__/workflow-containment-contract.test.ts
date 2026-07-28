import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKFLOW_DIR = ".github/workflows";
const WORKFLOWS = readdirSync(WORKFLOW_DIR)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => [name, readFileSync(`${WORKFLOW_DIR}/${name}`, "utf8")] as const);

const ACTION_PINS = {
  "actions/checkout": "d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/upload-artifact": "b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  "denoland/setup-deno": "22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
  "oven-sh/setup-bun": "0c5077e51419868618aeaa5fe8019c62421857d6",
} as const;
const DOCKER_IMAGE_PINS = new Set([
  "docker://rhysd/actionlint@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9",
]);

const workflow = (name: string) =>
  WORKFLOWS.find(([workflowName]) => workflowName === name)?.[1] ?? "";

describe("workflow containment contract", () => {
  it("pins every third-party action to an audited immutable revision", () => {
    for (const [name, source] of WORKFLOWS) {
      const uses = [
        ...source.matchAll(/^\s*(?:-\s+)?uses:\s+([^\s#]+)/gm),
      ].map((match) => match[1]);

      expect(uses.length, `${name} must declare at least one action`).toBeGreaterThan(
        0,
      );

      for (const action of uses) {
        if (action.startsWith("docker://")) {
          expect(DOCKER_IMAGE_PINS, `${name} action image`).toContain(action);
          continue;
        }

        expect(action, `${name} action`).toMatch(
          /^[^@/]+\/[^@/]+@[0-9a-f]{40}$/,
        );
        const [actionName, revision] = action.split("@");
        expect(ACTION_PINS, `${name} action pin`).toHaveProperty(actionName);
        expect(revision, `${name} ${actionName} revision`).toBe(
          ACTION_PINS[actionName as keyof typeof ACTION_PINS],
        );
      }
    }
  });

  it("always reports extension E2E on pull requests", () => {
    const extension = workflow("extension-e2e.yml");

    expect(extension).toMatch(/^  pull_request:\s*$/m);
    expect(extension).not.toMatch(
      /^  pull_request:\s*\n(?:^\s*$\n|^\s{4}.+\n)*?^\s{4}paths:/m,
    );
  });

  it("binds the requested deployed SHA to the approved release-manifest candidate before checkout", () => {
    const postDeploy = workflow("pwa-update-smoke-post-deploy.yml");
    const manifestCheckout = postDeploy.indexOf(
      "name: Checkout approved release manifest",
    );
    const candidateVerification = postDeploy.indexOf(
      "name: Verify release manifest candidate",
    );
    const deployedCheckout = postDeploy.indexOf(
      "name: Checkout approved deployed commit",
    );

    expect(postDeploy).toContain(
      "RELEASE_MANIFEST_PATH: docs/security/release-manifests/2026-07-capability-rollout.md",
    );
    expect(postDeploy).toContain(
      "ref: ${{ github.event.repository.default_branch }}",
    );
    expect(postDeploy).toContain("Release candidate SHA:");
    expect(postDeploy).toContain("candidate_sha");
    expect(postDeploy).toContain('"$candidate_sha" != "$DEPLOYED_SHA"');
    expect(postDeploy).toContain("ref: ${{ env.DEPLOYED_SHA }}");
    expect(manifestCheckout).toBeGreaterThan(-1);
    expect(candidateVerification).toBeGreaterThan(manifestCheckout);
    expect(deployedCheckout).toBeGreaterThan(candidateVerification);
  });
});
