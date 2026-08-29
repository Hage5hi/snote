export type LiveReleaseInput = {
  baseUrl: string | undefined;
  expectedSha: string | undefined;
  expectedCapabilityRoutesEnabled: string | undefined;
};

export type LiveReleaseIdentity = {
  deployedSha: string;
  capabilityRoutesEnabled: boolean;
};

export type FetchLike = (
  url: URL,
  init: RequestInit,
) => Promise<Response>;

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function expectedCapability(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    "EXPECTED_CAPABILITY_ROUTES_ENABLED must be exactly true or false.",
  );
}

function manifestUrl(baseUrl: string | undefined): URL {
  try {
    const url = new URL(baseUrl ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    if (url.username || url.password) throw new Error();
    return new URL("/version.json", url);
  } catch {
    throw new Error("SMOKE_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }
}

function hasNoStore(value: string | null): boolean {
  return value?.split(",").some(
    (directive) => directive.trim().toLowerCase() === "no-store",
  ) ?? false;
}

export async function verifyLiveRelease(
  input: LiveReleaseInput,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<LiveReleaseIdentity> {
  if (!input.expectedSha || !COMMIT_SHA.test(input.expectedSha)) {
    throw new Error(
      "EXPECTED_DEPLOYED_SHA must be an exact 40-character lowercase commit SHA.",
    );
  }
  const capabilityRoutesEnabled = expectedCapability(
    input.expectedCapabilityRoutesEnabled,
  );
  const url = manifestUrl(input.baseUrl);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Unable to fetch live release manifest.");
  }

  if (response.status !== 200) {
    throw new Error(`Live release manifest returned HTTP ${response.status}.`);
  }
  if (!hasNoStore(response.headers.get("Cache-Control"))) {
    throw new Error("Live release manifest must use Cache-Control: no-store.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Live release manifest is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Live release manifest must be a JSON object.");
  }

  const manifest = body as Record<string, unknown>;
  if (manifest.deployedSha !== input.expectedSha) {
    throw new Error("Live release SHA does not match the expected deployment.");
  }
  if (manifest.capabilityRoutesEnabled !== capabilityRoutesEnabled) {
    throw new Error(
      "Live capability route state does not match the expected deployment.",
    );
  }

  return {
    deployedSha: input.expectedSha,
    capabilityRoutesEnabled,
  };
}

if (import.meta.main) {
  try {
    const identity = await verifyLiveRelease({
      baseUrl: process.env.SMOKE_BASE_URL,
      expectedSha: process.env.EXPECTED_DEPLOYED_SHA,
      expectedCapabilityRoutesEnabled:
        process.env.EXPECTED_CAPABILITY_ROUTES_ENABLED,
    });
    console.log(
      `Verified live release ${identity.deployedSha} `
      + `capabilityRoutesEnabled=${identity.capabilityRoutesEnabled}`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Live release attestation failed.",
    );
    process.exitCode = 1;
  }
}
