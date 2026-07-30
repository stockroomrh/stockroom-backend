import { describe, expect, it } from "vitest";
import { checkRateLimit, RateLimitError } from "./rate-limit";

describe("checkRateLimit", () => {
  it("allows calls up to the limit", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(() => checkRateLimit(key, 5, 60)).not.toThrow();
  });

  it("throws RateLimitError once the limit is exceeded", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60);
    expect(() => checkRateLimit(key, 5, 60)).toThrow(RateLimitError);
  });

  it("keeps separate windows per key", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(keyA, 3, 60);
    expect(() => checkRateLimit(keyB, 3, 60)).not.toThrow();
  });

  it("reports a positive retryAfterSeconds", () => {
    const key = `test-${Math.random()}`;
    checkRateLimit(key, 1, 60);
    try {
      checkRateLimit(key, 1, 60);
      throw new Error("expected RateLimitError");
    } catch (cause) {
      expect(cause).toBeInstanceOf(RateLimitError);
      expect((cause as RateLimitError).retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});
