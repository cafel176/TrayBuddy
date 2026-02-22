import { describe, expect, it } from "vitest";
import { calculateDisplayDuration, parseMarkdown } from "$lib/bubble/markdown";

describe("markdown utilities", () => {
  it("parses markdown with escaping, bold, link, and newline", () => {
    const input = "Hello **bold** & <tag>\n[link](https://example.com)";
    const output = parseMarkdown(input);

    expect(output).toContain("Hello <strong>bold</strong> &amp; &lt;tag&gt;");
    expect(output).toContain("<a href=\"https://example.com\" target=\"_blank\" rel=\"noopener\">link</a>");
    expect(output).toContain("<br>");
  });

  it("calculates display duration with min/max bounds", () => {
    expect(calculateDisplayDuration("")).toBe(2000);
    expect(calculateDisplayDuration("short")).toBe(2000);
    expect(calculateDisplayDuration("x".repeat(100))).toBe(10000);
  });
});
