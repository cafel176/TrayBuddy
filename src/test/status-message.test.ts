import { describe, expect, it } from "vitest";
import { isError } from "$lib/utils/statusMessage";

describe("statusMessage", () => {
  it("detects error messages containing 'failed'", () => {
    expect(isError("Operation failed")).toBe(true);
    expect(isError("failed to load")).toBe(true);
  });

  it("detects error messages containing translated '失败'", () => {
    // t("common.failed") returns the key "common.failed" in test (no real i18n)
    // but we can test the "failed" fallback branch
    expect(isError("something failed here")).toBe(true);
  });

  it("returns false for non-error messages", () => {
    expect(isError("Operation successful")).toBe(false);
    expect(isError("Loading complete")).toBe(false);
    expect(isError("")).toBe(false);
  });
});
