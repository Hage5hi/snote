import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorSkeleton } from "../EditorSkeleton";

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("EditorSkeleton accessibility", () => {
  it("announces loading and disables pulse animation for reduced motion", () => {
    const { container } = render(<EditorSkeleton />);
    expect(screen.getByRole("status")).toHaveAccessibleName("common.loading");
    for (const pulse of container.querySelectorAll(".animate-pulse")) {
      expect(pulse).toHaveClass("motion-reduce:animate-none");
    }
  });
});
