import { useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RawView from "../RawView";

type NoteRow = {
  content: string | null;
  ydoc_state: string | null;
  is_encrypted: boolean;
  enc_salt: string | null;
  enc_check: string | null;
  enc_iterations: number | null;
};

type QueryResult = { data: NoteRow | null; error: { message: string } | null };

const harness = vi.hoisted(() => ({
  query: vi.fn<(slug: string) => Promise<QueryResult>>(),
  deriveKey: vi.fn(),
  verifyCheck: vi.fn(),
  decryptBytes: vi.fn(),
  routeCommit: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_column: string, slug: string) => ({
          maybeSingle: () => harness.query(slug),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/crypto", () => ({
  deriveKey: (...args: unknown[]) => harness.deriveKey(...args),
  verifyCheck: (...args: unknown[]) => harness.verifyCheck(...args),
  decryptBytes: (...args: unknown[]) => harness.decryptBytes(...args),
  iterationsFor: (value: number | null) => value ?? 100_000,
}));

vi.mock("@/lib/yjs/base64", () => ({
  base64ToBytes: (value: string) => new TextEncoder().encode(value),
}));

vi.mock("yjs", () => {
  class Doc {
    text = "";
    getText() {
      return { toString: () => this.text };
    }
    destroy() {}
  }
  return {
    Doc,
    applyUpdate: (doc: Doc, update: Uint8Array) => {
      doc.text = new TextDecoder().decode(update);
    },
  };
});

vi.mock("react-helmet-async", () => ({ Helmet: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function plaintext(content: string): QueryResult {
  return {
    data: {
      content,
      ydoc_state: null,
      is_encrypted: false,
      enc_salt: null,
      enc_check: null,
      enc_iterations: null,
    },
    error: null,
  };
}

function encrypted(label: string): QueryResult {
  return {
    data: {
      content: "",
      ydoc_state: `ciphertext-${label}`,
      is_encrypted: true,
      enc_salt: `salt-${label}`,
      enc_check: `check-${label}`,
      enc_iterations: 1,
    },
    error: null,
  };
}

function RouteHarness() {
  const navigate = useNavigate();
  const location = useLocation();
  useLayoutEffect(() => {
    harness.routeCommit(
      location.pathname,
      document.querySelector(".raw-pre")?.textContent ?? "",
    );
  }, [location.pathname, location.search, location.hash]);
  return (
    <>
      <button type="button" onClick={() => navigate("/b.md")}>open-b</button>
      <button type="button" onClick={() => navigate("/a.md#key-a")}>add-key</button>
      <Routes>
        <Route path="/:slug" element={<RawView />} />
      </Routes>
    </>
  );
}

function renderAt(path: string, state: unknown = null) {
  window.history.replaceState(state, "", path);
  return render(
    <BrowserRouter>
      <RouteHarness />
    </BrowserRouter>,
  );
}

describe("RawView route-state isolation", () => {
  beforeEach(() => {
    harness.query.mockReset();
    harness.deriveKey.mockReset();
    harness.verifyCheck.mockReset();
    harness.decryptBytes.mockReset();
    harness.routeCommit.mockReset();
    harness.deriveKey.mockResolvedValue({});
    harness.verifyCheck.mockResolvedValue(true);
    harness.decryptBytes.mockResolvedValue(new TextEncoder().encode("decrypted"));
    window.history.replaceState(null, "", "/");
  });

  it("clears rendered text immediately when the slug changes", async () => {
    const bResult = deferred<QueryResult>();
    harness.query.mockImplementation((slug) => {
      if (slug === "a") return Promise.resolve(plaintext("content-a"));
      return bResult.promise;
    });

    renderAt("/a.md");
    expect(await screen.findByText("content-a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "open-b" }));

    expect(await screen.findByText("# loading…")).toBeInTheDocument();
    expect(screen.queryByText("content-a")).not.toBeInTheDocument();
    expect(harness.routeCommit).toHaveBeenCalledWith(
      "/b.md",
      expect.stringMatching(/^# loading/),
    );

    await act(async () => bResult.resolve(plaintext("content-b")));
    expect(await screen.findByText("content-b")).toBeInTheDocument();
  });

  it("clears the prior key error and reloads when the fragment key changes", async () => {
    harness.query.mockResolvedValue(encrypted("a"));
    harness.decryptBytes.mockResolvedValue(new TextEncoder().encode("decrypted-a"));

    renderAt("/a.md");
    expect(await screen.findByText(/This note is encrypted/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "add-key" }));

    expect(await screen.findByText("decrypted-a")).toBeInTheDocument();
    expect(screen.queryByText(/This note is encrypted/)).not.toBeInTheDocument();
  });

  it("does not let deferred crypto from route A overwrite route B", async () => {
    const aDecryption = deferred<Uint8Array>();
    harness.query.mockImplementation((slug) =>
      Promise.resolve(slug === "a" ? encrypted("a") : plaintext("content-b")),
    );
    harness.decryptBytes.mockImplementation(() => aDecryption.promise);

    renderAt("/a.md#key-a");
    await waitFor(() => expect(harness.decryptBytes).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "open-b" }));
    expect(await screen.findByText("content-b")).toBeInTheDocument();

    await act(async () => {
      aDecryption.resolve(new TextEncoder().encode("late-content-a"));
      await aDecryption.promise;
    });

    expect(screen.getByText("content-b")).toBeInTheDocument();
    expect(screen.queryByText("late-content-a")).not.toBeInTheDocument();
  });

  it("rejects route A plaintext when browser history changes before Router commits", async () => {
    const aDecryption = deferred<Uint8Array>();
    harness.query.mockResolvedValue(encrypted("a"));
    harness.decryptBytes.mockImplementation(() => aDecryption.promise);

    renderAt("/a.md#key-a");
    await waitFor(() => expect(harness.decryptBytes).toHaveBeenCalledOnce());

    // BrowserRouter writes history before its transition commits the new
    // render. Keep the old RawView mounted to exercise that ownership gap.
    window.history.pushState(window.history.state, "", "/b.md");
    await act(async () => {
      aDecryption.resolve(new TextEncoder().encode("private-content-a"));
      await aDecryption.promise;
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/b.md");
    expect(screen.queryByText("private-content-a")).not.toBeInTheDocument();
  });

  it("preserves history state while migrating a query key into the fragment", async () => {
    const originalState = { navigationId: 17, retained: "yes" };
    harness.query.mockResolvedValue(encrypted("a"));
    harness.decryptBytes.mockResolvedValue(new TextEncoder().encode("decrypted-a"));

    renderAt("/a.md?key=secret", originalState);
    const stateBeforeMigration = window.history.state;
    expect(stateBeforeMigration).toEqual(expect.objectContaining(originalState));

    expect(await screen.findByText("decrypted-a")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/a.md");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#secret");
    expect(window.history.state).toEqual(stateBeforeMigration);
  });
});
