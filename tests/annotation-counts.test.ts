import { describe, expect, it } from "vitest";
import { readAnnotationCounts } from "../lib/annotation-counts";

const root = (markup: string) => {
  const element = document.createElement("section");
  element.innerHTML = markup;
  return element;
};

describe("annotation severity counts", () => {
  it("uses full native summary totals instead of truncated rendered messages", () => {
    expect(
      readAnnotationCounts(
        root(
          "<h2>Annotations</h2><p>1,234 errors, 2 warnings and 1 notice</p><annotation-message><svg class='octicon-info'></svg></annotation-message>",
        ),
      ),
    ).toEqual({ error: 1234, warning: 2, notice: 1 });
  });
  it("uses native icons without inferring severity from message text", () => {
    expect(
      readAnnotationCounts(
        root(
          "<annotation-message><svg class='octicon-alert'></svg></annotation-message><annotation-message><svg class='octicon-info'></svg></annotation-message><annotation-message>error in arbitrary prose</annotation-message>",
        ),
      ),
    ).toEqual({ error: 0, warning: 1, notice: 1 });
    expect(readAnnotationCounts(null)).toEqual({
      error: 0,
      warning: 0,
      notice: 0,
    });
  });
});
