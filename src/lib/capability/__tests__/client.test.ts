import { describe, expect, it, vi } from "vitest";
import { createCapabilityApi, type NoteSession } from "../client";

const TOKEN = "b".repeat(43);

function session(overrides: Partial<NoteSession> = {}): NoteSession {
  return {
    noteId: "00000000-0000-4000-8000-000000000001",
    slug: "daily",
    scope: "owner",
    realtimeToken: "header.payload.signature",
    realtimeExpiresAt: "2099-01-01T00:00:00.000Z",
    realtimeTopic: "note:00000000-0000-4000-8000-000000000001",
    syncStatus: "active",
    currentSequence: 0,
    payloadLimitBytes: 4_194_304,
    checkpointSequence: 0,
    checkpointVersion: null,
    checkpointPayload: null,
    checkpointEncryptionVersion: null,
    missingUpdates: [],
    encryption: { enabled: false, version: 0, salt: null, check: null, iterations: 600_000 },
    ...overrides,
  };
}

describe("capability API client", () => {
  it("creates a note without putting any capability in the request", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.headers).not.toMatchObject({ Authorization: expect.anything() });
      expect(JSON.parse(String(init?.body))).toEqual({ action: "create", slug: "daily" });
      return Response.json({
        session: session(),
        capabilities: { owner: TOKEN, edit: "c".repeat(43), view: "d".repeat(43) },
      }, { status: 201 });
    });
    const api = createCapabilityApi({ baseUrl: "https://project.supabase.co", fetcher });

    const created = await api.createNote("daily");

    expect(created.capabilities.owner).toBe(TOKEN);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://project.supabase.co/functions/v1/note-session",
    );
  });

  it("opens every missing update page with a Bearer header", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      const body = JSON.parse(String(init?.body));
      if (body.afterSequence === 0) {
        return Response.json({ session: session({
          currentSequence: 3,
          missingUpdates: [
            { updateId: "1".repeat(64), payload: "AQ", sequence: 1, encryptionVersion: 0 },
            { updateId: "2".repeat(64), payload: "Ag", sequence: 2, encryptionVersion: 0 },
          ],
        }) });
      }
      expect(body.afterSequence).toBe(2);
      return Response.json({ session: session({
        currentSequence: 3,
        missingUpdates: [
          { updateId: "3".repeat(64), payload: "Aw", sequence: 3, encryptionVersion: 0 },
        ],
      }) });
    });
    const api = createCapabilityApi({ baseUrl: "https://project.supabase.co", fetcher });

    const opened = await api.openSession(TOKEN);

    expect(opened.missingUpdates.map((update) => update.sequence)).toEqual([1, 2, 3]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("syncs an idempotent update batch without serializing the token", async () => {
    const update = { updateId: "4".repeat(64), payload: "BA", encryptionVersion: 0 };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).not.toContain(TOKEN);
      expect(String(init?.body)).not.toContain(TOKEN);
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      return Response.json({
        acknowledgements: [{ updateId: update.updateId, sequence: 4 }],
        session: session({ currentSequence: 4 }),
      });
    });
    const api = createCapabilityApi({ baseUrl: "https://project.supabase.co", fetcher });

    const response = await api.sync(TOKEN, {
      updates: [update],
      expectedEncryptionVersion: 0,
      afterSequence: 3,
    });

    expect(response.acknowledgements).toEqual([{ updateId: update.updateId, sequence: 4 }]);
  });

  it("rejects malformed or internally inconsistent sessions", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      session: session({
        realtimeTopic: "note:someone-else",
        checkpointSequence: 2,
        currentSequence: 1,
        payloadLimitBytes: Number.MAX_SAFE_INTEGER,
      }),
    }));
    const api = createCapabilityApi({ baseUrl: "https://project.supabase.co", fetcher });

    await expect(api.openSession(TOKEN)).rejects.toThrow("invalid note session");
  });

  it("rejects acknowledgements that are not bounded update receipts", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      acknowledgements: [{ updateId: "not-a-hash", sequence: -1 }],
      session: session(),
    }));
    const api = createCapabilityApi({ baseUrl: "https://project.supabase.co", fetcher });

    await expect(api.sync(TOKEN, {
      updates: [],
      expectedEncryptionVersion: 0,
      afterSequence: 0,
    })).rejects.toThrow("invalid acknowledgements");
  });
});
