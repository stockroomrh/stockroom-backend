import { describe, expect, it } from "vitest";
import { getMode, isLiveModeEnabled, flagshipProjectSlug } from "./mode";

describe("mode", () => {
  it("defaults to preview outside a browser environment", () => {
    expect(getMode()).toBe("preview");
  });

  it("defaults live mode to disabled when the env flag is unset", () => {
    expect(isLiveModeEnabled()).toBe(false);
  });

  it("defaults the flagship project slug to stockroom", () => {
    expect(flagshipProjectSlug()).toBe("stockroom");
  });
});
