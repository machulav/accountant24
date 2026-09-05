import { describe, expect, it } from "vitest";
import { missingPathLabel } from "../not-found";

describe("missingPathLabel()", () => {
  it("should return a plain path as is", () => {
    expect(missingPathLabel("/pricng")).toBe("/pricng");
  });

  it("should decode percent-encoded characters for reading", () => {
    expect(missingPathLabel("/caf%C3%A9/men%C3%BC")).toBe("/café/menü");
  });

  it("should return the raw path when an escape is malformed", () => {
    expect(missingPathLabel("/100%/off")).toBe("/100%/off");
  });

  it("should return null for the site root", () => {
    expect(missingPathLabel("/")).toBeNull();
  });

  it("should return null for an empty path", () => {
    expect(missingPathLabel("")).toBeNull();
  });

  it("should return a path of exactly 80 characters", () => {
    const path = `/${"a".repeat(79)}`;
    expect(missingPathLabel(path)).toBe(path);
  });

  it("should return null for a path of 81 characters", () => {
    expect(missingPathLabel(`/${"a".repeat(80)}`)).toBeNull();
  });

  it("should measure the length after decoding", () => {
    // 3 bytes each when encoded (%C3%A9), 1 character each once decoded.
    const encoded = `/${"%C3%A9".repeat(40)}`;
    expect(encoded.length).toBeGreaterThan(80);
    expect(missingPathLabel(encoded)).toBe(`/${"é".repeat(40)}`);
  });
});
