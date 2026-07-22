import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPanel from "../AdminPanel";

type InvokeResult = {
  data: Record<string, unknown> | null;
  error: unknown;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const harness = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => harness.invoke(...args),
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => harness.toast(...args) }));
vi.mock("@/components/admin/RotatePassDialog", () => ({ RotatePassDialog: () => null }));
vi.mock("../NotFound", () => ({ default: () => <div>Access denied</div> }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: () => <input type="checkbox" readOnly /> }));
vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  Trash2: () => null,
  Search: () => null,
  RefreshCw: () => null,
  X: () => null,
  KeyRound: () => null,
}));

function resultFor(slug: string): InvokeResult {
  return {
    data: {
      items: [{
        slug,
        updated_at: "2026-07-22T00:00:00.000Z",
        is_encrypted: false,
        char_count: slug.length,
        preview: slug,
        tags: [],
      }],
      total: 1,
      topTags: [],
    },
    error: null,
  };
}

describe("AdminPanel session request ownership", () => {
  beforeEach(() => {
    harness.invoke.mockReset();
    harness.toast.mockReset();
    sessionStorage.clear();
    sessionStorage.setItem("__a_session", "session-a");
    sessionStorage.setItem(
      "__a_session_expiry",
      new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores an older list response that completes after a newer search", async () => {
    const first = deferred<InvokeResult>();
    const second = deferred<InvokeResult>();
    harness.invoke.mockImplementation(
      (_name: string, options: { body?: { search?: string } }) => {
        const search = options.body?.search ?? "";
        if (search === "first") return first.promise;
        if (search === "second") return second.promise;
        return Promise.resolve({ data: { items: [], total: 0, topTags: [] }, error: null });
      },
    );

    render(
      <MemoryRouter>
        <AdminPanel />
      </MemoryRouter>,
    );
    await screen.findByText("Admin · 0 note");

    const input = screen.getByPlaceholderText(/Search by slug or content/);
    const form = input.closest("form");
    expect(form).not.toBeNull();

    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.submit(form!);
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.submit(form!);

    await waitFor(() => {
      const searches = harness.invoke.mock.calls
        .map((call) => call[1]?.body?.search)
        .filter(Boolean);
      expect(searches).toEqual(["first", "second"]);
    });
    await act(async () => second.resolve(resultFor("second-result")));
    expect(await screen.findByText("/second-result")).toBeInTheDocument();

    await act(async () => first.resolve(resultFor("first-result")));
    await waitFor(() => {
      expect(screen.queryByText("/first-result")).not.toBeInTheDocument();
      expect(screen.getByText("/second-result")).toBeInTheDocument();
    });
  });

  it("purges rendered data and storage exactly when the server expiry elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    sessionStorage.setItem("__a_session_expiry", "2026-07-22T00:00:01.000Z");
    const initial = deferred<InvokeResult>();
    harness.invoke.mockReturnValue(initial.promise);

    render(
      <MemoryRouter>
        <AdminPanel />
      </MemoryRouter>,
    );
    await act(async () => initial.resolve(resultFor("private-preview")));
    expect(screen.getByText("/private-preview")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_001));
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("/private-preview")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("__a_session")).toBeNull();
    expect(sessionStorage.getItem("__a_session_expiry")).toBeNull();
  });

  it("does not let an old component's late 401 delete a newer stored session", async () => {
    const stale = deferred<InvokeResult>();
    harness.invoke.mockImplementation(
      (_name: string, options: { body?: { search?: string } }) =>
        options.body?.search === "late"
          ? stale.promise
          : Promise.resolve({ data: { items: [], total: 0, topTags: [] }, error: null }),
    );

    const firstView = render(
      <MemoryRouter>
        <AdminPanel />
      </MemoryRouter>,
    );
    await screen.findByText("Admin · 0 note");
    const input = screen.getByPlaceholderText(/Search by slug or content/);
    fireEvent.change(input, { target: { value: "late" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => {
      expect(
        harness.invoke.mock.calls.some((call) => call[1]?.body?.search === "late"),
      ).toBe(true);
    });
    firstView.unmount();

    sessionStorage.setItem("__a_session", "session-b");
    sessionStorage.setItem(
      "__a_session_expiry",
      new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    );
    render(
      <MemoryRouter>
        <AdminPanel />
      </MemoryRouter>,
    );
    await screen.findByText("Admin · 0 note");

    await act(async () => stale.resolve({ data: { error: "unauthorized" }, error: null }));
    expect(sessionStorage.getItem("__a_session")).toBe("session-b");
    expect(screen.getByText("Admin · 0 note")).toBeInTheDocument();
  });
});
