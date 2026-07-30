import { describe, expect, it } from "vitest";
import { builtInProjectBundles } from "./mock-data";
import { ProjectSchema, TreasurySummarySchema, TreasuryPositionSchema } from "./schemas";

describe("schemas", () => {
  it("validates every built-in project against ProjectSchema", () => {
    for (const bundle of builtInProjectBundles) {
      expect(() => ProjectSchema.parse(bundle.project)).not.toThrow();
    }
  });

  it("validates every built-in treasury summary", () => {
    for (const bundle of builtInProjectBundles) {
      expect(() => TreasurySummarySchema.parse(bundle.summary)).not.toThrow();
    }
  });

  it("validates every built-in treasury position", () => {
    for (const bundle of builtInProjectBundles) {
      for (const position of bundle.positions) {
        expect(() => TreasuryPositionSchema.parse(position)).not.toThrow();
      }
    }
  });
});
