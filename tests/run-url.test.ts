import { describe, expect, it } from "vitest";
import {
  currentLogLayout,
  currentRunView,
  jobHref,
  runViewHref,
  selectedJobPath,
} from "../lib/run-url";

describe("shared run view URL context", () => {
  const root = "https://github.com/acme/widget/actions/runs/102";
  it("uses the List view by default and ignores unsupported view names", () => {
    expect(currentRunView(new URL(root))).toBe("summary");
    expect(currentRunView(new URL(`${root}?ae_view=malicious`))).toBe(
      "summary",
    );
    expect(currentRunView(new URL(`${root}?ae_view=table`))).toBe("table");
  });
  it("preserves native query parameters and selection when graph needs the summary", () => {
    const href = new URL(
      runViewHref(
        "graph",
        new URL(`${root}/job/12?check_suite_focus=true&attempt=2#step:1:3`),
      ),
    );
    expect(href.pathname).toBe("/acme/widget/actions/runs/102/attempts/2");
    expect(href.searchParams.get("ae_job")).toBe("12");
    expect(href.searchParams.get("ae_view")).toBe("graph");
    expect(href.searchParams.get("attempt")).toBe("2");
    expect(href.searchParams.get("check_suite_focus")).toBe("true");
    expect(selectedJobPath(href)).toBe("/acme/widget/actions/runs/102/job/12");
  });
  it.each(["run-summary", "annotations", "artifacts"] as const)(
    "routes %s to the native run page while preserving job selection",
    (view) => {
      const href = new URL(
        runViewHref(
          view,
          new URL(`${root}/job/12?attempt=2&check_suite_focus=true`),
        ),
      );
      expect(href.pathname).toBe(
        `${root.replace("https://github.com", "")}/attempts/2`,
      );
      expect(href.searchParams.get("ae_job")).toBe("12");
      expect(href.searchParams.get("ae_view")).toBe(view);
      expect(href.searchParams.get("check_suite_focus")).toBe("true");
    },
  );
  it("uses actual selected-job path before optional summary selection metadata", () => {
    expect(selectedJobPath(new URL(`${root}/job/15?ae_job=12`))).toBe(
      "/acme/widget/actions/runs/102/job/15",
    );
    expect(selectedJobPath(new URL(`${root}?ae_job=12`))).toBe(
      "/acme/widget/actions/runs/102/job/12",
    );
    expect(selectedJobPath(new URL(`${root}?ae_job=../15`))).toBe("");
  });
  it("keeps view and native destination query while navigating a job", () => {
    const href = new URL(
      jobHref(
        `${root}/job/20?check_suite_focus=true`,
        new URL(`${root}?ae_view=table&ae_job=12`),
      ),
    );
    expect(href.pathname).toBe("/acme/widget/actions/runs/102/job/20");
    expect(href.searchParams.get("ae_view")).toBe("table");
    expect(href.searchParams.has("ae_job")).toBe(false);
    expect(href.searchParams.get("check_suite_focus")).toBe("true");
    expect(
      jobHref("https://example.com/other", new URL(`${root}?ae_view=table`)),
    ).toBe("https://example.com/other");
  });
  it("carries open log layouts across jobs but never a closed log pane", () => {
    const below = new URL(
      jobHref(`${root}/job/20`, new URL(`${root}/job/12?ae_layout=below`)),
    );
    expect(below.searchParams.get("ae_layout")).toBe("below");
    expect(currentLogLayout(below)).toBe("below");
    const closed = new URL(
      jobHref(`${root}/job/20`, new URL(`${root}/job/12?ae_layout=closed`)),
    );
    expect(closed.searchParams.has("ae_layout")).toBe(false);
    expect(currentLogLayout(new URL(`${root}?ae_layout=bogus`))).toBe("side");
  });
  it("clears only extension view state on returning to Summary", () => {
    const href = new URL(
      runViewHref(
        "summary",
        new URL(`${root}?ae_view=table&attempt=2&ae_job=12`),
      ),
    );
    expect(href.searchParams.has("ae_view")).toBe(false);
    expect(href.searchParams.get("ae_job")).toBe("12");
    expect(href.searchParams.get("attempt")).toBe("2");
  });
  it("keeps the run-level tab selected when navigating to another job", () => {
    const href = new URL(
      jobHref(
        `${root}/job/20`,
        new URL(`${root}?ae_view=run-summary&ae_job=12`),
      ),
    );
    expect(href.pathname).toBe(
      `${root.replace("https://github.com", "")}/job/20`,
    );
    expect(href.searchParams.get("ae_view")).toBe("run-summary");
  });
  it("preserves the selected job details tab while navigating between jobs", () => {
    const href = new URL(
      jobHref(
        `${root}/job/20`,
        new URL(`${root}/job/12?ae_tab=details&ae_view=table`),
      ),
    );
    expect(href.searchParams.get("ae_tab")).toBe("details");
    expect(href.searchParams.get("ae_view")).toBe("table");
  });
  it("retains canonical attempt context across job and native summary views", () => {
    const current = new URL(`${root}/attempts/2?ae_view=table&ae_job=12`);
    const job = new URL(jobHref(`${root}/job/12`, current));
    expect(job.searchParams.get("attempt")).toBe("2");
    expect(job.searchParams.get("ae_view")).toBe("table");
    const graph = new URL(runViewHref("graph", job));
    expect(graph.pathname).toBe("/acme/widget/actions/runs/102/attempts/2");
    expect(graph.searchParams.get("ae_job")).toBe("12");
    expect(new URL(runViewHref("annotations", current)).pathname).toBe(
      "/acme/widget/actions/runs/102/attempts/2",
    );
  });
});
