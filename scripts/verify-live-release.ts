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

export type LiveReleaseWaitOptions = {
  timeoutMs: number;
  pollMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

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
  if (value === null) return false;

  const directives: string[] = [];
  let directiveStart = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (quoted && character === "\\") {
      escaped = true;
    } else if (character === "\"") {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      directives.push(value.slice(directiveStart, index));
      directiveStart = index + 1;
    }
  }

  if (quoted || escaped) return false;
  directives.push(value.slice(directiveStart));
  return directives.some(
    (directive) => directive.trim().toLowerCase() === "no-store",
  );
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
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache",
      },
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

const RETRYABLE_LIVE_RELEASE =
  /Live release SHA does not match|Unable to fetch live release manifest|Live release manifest returned HTTP 5\d\d/;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function waitForLiveRelease(
  input: LiveReleaseInput,
  options: LiveReleaseWaitOptions,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<LiveReleaseIdentity> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + options.timeoutMs;

  for (;;) {
    try {
      return await verifyLiveRelease(input, fetchImpl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!RETRYABLE_LIVE_RELEASE.test(message) || now() >= deadline) {
        throw error;
      }
      await sleep(options.pollMs);
    }
  }
}

function parseWaitMs(value: string | undefined): number {
  if (value === undefined || value === "") return 0;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("LIVE_RELEASE_WAIT_MS must be a non-negative integer.");
  }
  return Number(value);
}

function parsePollMs(value: string | undefined): number {
  if (value === undefined || value === "") return 15_000;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("LIVE_RELEASE_POLL_MS must be a positive integer.");
  }
  return Number(value);
}

if (import.meta.main) {
  try {
    const input = {
      baseUrl: process.env.SMOKE_BASE_URL,
      expectedSha: process.env.EXPECTED_DEPLOYED_SHA,
      expectedCapabilityRoutesEnabled:
        process.env.EXPECTED_CAPABILITY_ROUTES_ENABLED,
    };
    const waitMs = parseWaitMs(process.env.LIVE_RELEASE_WAIT_MS);
    const identity = waitMs > 0
      ? await waitForLiveRelease(input, {
        timeoutMs: waitMs,
        pollMs: parsePollMs(process.env.LIVE_RELEASE_POLL_MS),
      })
      : await verifyLiveRelease(input);
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
