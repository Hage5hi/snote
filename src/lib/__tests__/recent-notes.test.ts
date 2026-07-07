import { describe, it, expect, beforeEach } from "vitest";
import {
  getRecents,
  touchRecent,
  removeRecent,
  clearRecents,
  getPinned,
  isPinned,
  togglePin,
} from "../recent-notes";

describe("recent-notes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("recents list", () => {
    it("returns empty array on first call", () => {
      expect(getRecents()).toEqual([]);
    });

    it("touchRecent adds new entry and moves existing to front", () => {
      touchRecent("alpha", "preview-a");
      touchRecent("beta", "preview-b");
      touchRecent("alpha", "preview-a-updated");
      const recents = getRecents();
      expect(recents[0].slug).toBe("alpha");
      expect(recents[0].preview).toBe("preview-a-updated");
      expect(recents.length).toBe(2);
    });

    it("removeRecent removes entry by slug", () => {
      touchRecent("alpha");
      touchRecent("beta");
      removeRecent("alpha");
      expect(getRecents().map((r) => r.slug)).toEqual(["beta"]);
    });

    it("clearRecents empties list", () => {
      touchRecent("alpha");
      clearRecents();
      expect(getRecents()).toEqual([]);
    });
  });

  describe("pinned list", () => {
    it("returns empty on first call", () => {
      expect(getPinned()).toEqual([]);
    });

    it("togglePin toggles slug in/out", () => {
      togglePin("alpha");
      expect(isPinned("alpha")).toBe(true);
      togglePin("alpha");
      expect(isPinned("alpha")).toBe(false);
    });
  });
});

