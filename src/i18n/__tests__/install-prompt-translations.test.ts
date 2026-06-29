// Verifies each status/step key referenced by InstallPrompt has a real
// translation in every locale — never empty, never equal to the key
// itself (which is what useI18n falls back to when a key is missing).
import { describe, it, expect } from "vitest";
import { dict, SUPPORTED_LANGS } from "@/i18n";

const STATUS_KEYS = [
  "install.status_installed_label",
  "install.status_installed_reason",
  "install.status_ready_label",
  "install.status_ready_reason",
  "install.status_ios_label",
  "install.status_ios_reason",
  "install.status_firefox_label",
  "install.status_firefox_reason",
  "install.status_waiting_label",
  "install.status_waiting_reason",
  "install.status_unsupported_label",
  "install.status_unsupported_reason",
] as const;

const STEP_KEYS = [
  "install.step_completed",
  "install.step_mark",
  "install.app_step_ios_1",
  "install.app_step_ios_2",
  "install.app_step_ios_3",
  "install.app_step_ios_4",
  "install.app_step_android_1",
  "install.app_step_desktop_1",
  "install.app_step_chromium_2",
  "install.app_step_chromium_3",
  "install.app_step_chromium_4",
  "install.ext_step_download",
  "install.ext_step_unzip",
  "install.ext_step_devmode",
  "install.ext_step_loadunpacked",
] as const;

const ALL_KEYS = [...STATUS_KEYS, ...STEP_KEYS];

describe("InstallPrompt status/step translations are real (no fallback)", () => {
  for (const lang of SUPPORTED_LANGS) {
    it(`locale "${lang}" has a non-fallback translation for every status/step key`, () => {
      const d = dict[lang] as Record<string, string>;
      const offenders: Array<{ key: string; value: unknown; reason: string }> = [];
      for (const k of ALL_KEYS) {
        const v = d[k];
        if (typeof v !== "string") {
          offenders.push({ key: k, value: v, reason: "missing" });
          continue;
        }
        if (v.trim() === "") {
          offenders.push({ key: k, value: v, reason: "empty" });
          continue;
        }
        if (v.trim() === k) {
          offenders.push({ key: k, value: v, reason: "equals-key (fallback)" });
          continue;
        }
      }
      expect(
        { lang, offenders },
        `locale ${lang} has fallback/empty install translations`,
      ).toEqual({ lang, offenders: [] });
    });

    // English is the reference; every other locale must differ from EN
    // for at least the human-readable label keys (otherwise it's just
    // pass-through). Skip EN itself.
    if (lang !== "en") {
      it(`locale "${lang}" actually translates labels (differs from English)`, () => {
        const d = dict[lang] as Record<string, string>;
        const en = dict.en as Record<string, string>;
        const labelKeys = ALL_KEYS.filter((k) => k.endsWith("_label"));
        const identical = labelKeys.filter((k) => d[k] === en[k]);
        // Allow at most 1 accidental match (proper nouns etc.).
        expect(
          identical.length,
          `locale ${lang} label keys identical to EN: ${identical.join(", ")}`,
        ).toBeLessThanOrEqual(1);
      });
    }
  }
});
