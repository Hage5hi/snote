import { fireEvent, render, screen } from "@testing-library/react";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";
import { TagChips } from "../TagChips";
import { CMDK_OPEN_EVENT } from "@/lib/cmdk-open";

vi.mock("@/i18n/index", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (!vars) return key;
      return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key);
    },
  }),
}));

describe("TagChips", () => {
  it("opens the command palette with #tag instead of routing to admin", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "Plan the #work sprint");
    const seen: string[] = [];
    const onCmdk = (event: Event) => {
      seen.push(String((event as CustomEvent<{ query?: string }>).detail?.query ?? ""));
    };
    window.addEventListener(CMDK_OPEN_EVENT, onCmdk);

    render(<TagChips doc={doc} isEncrypted={false} />);
    const chip = await screen.findByText("#work");
    fireEvent.click(chip);

    window.removeEventListener(CMDK_OPEN_EVENT, onCmdk);
    expect(seen).toEqual(["#work"]);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("/note#tag=");
  });
});
