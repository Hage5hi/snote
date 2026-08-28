import { describe, expect, it } from "vitest";
import {
  buildCapabilityUrl,
  buildCurrentEditShareUrl,
  parseCapabilityLocation,
  readEncryptionSecret,
  writeEncryptionSecretToHash,
} from "../url";

const TOKEN = "a".repeat(43);

describe("capability URL contract", () => {
  it("accepts owner and edit capabilities only on a note locator", () => {
    expect(parseCapabilityLocation(new URL(`https://note.syrin.online/daily#owner=${TOKEN}`))).toEqual({
      slug: "daily",
      scope: "owner",
      token: TOKEN,
    });
    expect(parseCapabilityLocation(new URL(`https://note.syrin.online/daily#edit=${TOKEN}`))).toEqual({
      slug: "daily",
      scope: "edit",
      token: TOKEN,
    });
  });

  it("accepts view capabilities only on the opaque /s route", () => {
    expect(parseCapabilityLocation(new URL(`https://note.syrin.online/s#view=${TOKEN}`))).toEqual({
      slug: null,
      scope: "view",
      token: TOKEN,
    });
    expect(parseCapabilityLocation(new URL(`https://note.syrin.online/daily#view=${TOKEN}`))).toBeNull();
  });

  it("never treats query or path material as a capability", () => {
    expect(parseCapabilityLocation(new URL(`https://note.syrin.online/daily?owner=${TOKEN}`))).toBeNull();
    expect(parseCapabilityLocation(new URL(`https://note.syrin.online/s/${TOKEN}`))).toBeNull();
    expect(parseCapabilityLocation(new URL(`https://note.syrin.online/daily#owner=short`))).toBeNull();
  });

  it("keeps an encryption secret separate from the authorization capability", () => {
    expect(readEncryptionSecret(`#owner=${TOKEN}&key=correct%20horse`)).toBe("correct horse");
    expect(readEncryptionSecret("#legacy-passphrase")).toBe("legacy-passphrase");
    expect(readEncryptionSecret(`#edit=${TOKEN}`)).toBe("");
    expect(writeEncryptionSecretToHash(`#edit=${TOKEN}`, "new secret")).toBe(
      `#edit=${TOKEN}&key=new+secret`,
    );
    expect(writeEncryptionSecretToHash("", "legacy secret")).toBe("#legacy%20secret");
    expect(writeEncryptionSecretToHash(`#legacy=${"x".repeat(32)}`, "old secret")).toBe(
      `#legacy=${"x".repeat(32)}&key=old+secret`,
    );
  });

  it("builds canonical capability URLs without query parameters", () => {
    expect(buildCapabilityUrl("owner", TOKEN, "daily")).toBe(
      `https://note.syrin.online/daily#owner=${TOKEN}`,
    );
    expect(buildCapabilityUrl("view", TOKEN)).toBe(
      `https://note.syrin.online/s#view=${TOKEN}`,
    );
  });

  it.each(["note", "Privacy", "S"])(
    "rejects reserved owner slug %s",
    (slug) => {
      expect(parseCapabilityLocation(new URL(`https://note.syrin.online/${slug}#owner=${TOKEN}`))).toBeNull();
      expect(() => buildCapabilityUrl("owner", TOKEN, slug)).toThrow("invalid slug");
    },
  );

  it("never exposes an owner capability as the default share URL", () => {
    expect(buildCurrentEditShareUrl({ slug: "daily", scope: "owner", token: TOKEN }, "daily"))
      .toBeNull();
    expect(buildCurrentEditShareUrl({ slug: "daily", scope: "edit", token: TOKEN }, "daily"))
      .toBe(`https://note.syrin.online/daily#edit=${TOKEN}`);
  });
});
