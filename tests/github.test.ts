import { afterEach, describe, expect, it } from "vitest";
import {
  filterItems,
  filterNativeItems,
  type Item,
  parseRoute,
  readStatus,
  readSurface,
} from "../lib/github";

const location = new URL("https://github.com/acme/widget/actions");
const row = (
  id: string,
  status = "check-circle-fill",
) => `<li aria-label="completed successfully: Run ${id} of Build and Test. Update widget">
  <svg class="octicon octicon-${status}"></svg>
  <h4><a href="/acme/widget/actions/runs/${id}">Update widget</a></h4>
  <a href="/octocat">octocat</a><a href="/acme/widget/tree/main">main</a>
  <relative-time datetime="2026-10-26T10:00:00Z">today</relative-time>
  <span><svg class="octicon octicon-stopwatch"></svg>2m 5s</span>
</li>`;
afterEach(() => {
  document.body.innerHTML = "";
});

describe("GitHub adapter", () => {
  it("supports Actions routes, not unrelated settings or invalid run paths", () => {
    expect(parseRoute("/acme/widget/actions")).toEqual({
      repository: "acme/widget",
      kind: "runs",
    });
    expect(parseRoute("/acme/widget/actions/workflows/ci.yml")?.kind).toBe(
      "runs",
    );
    expect(parseRoute("/acme/widget/actions/runs/1/job/2")?.kind).toBe("jobs");
    expect(parseRoute("/acme/widget/actions/runs/1/")?.kind).toBe("jobs");
    expect(parseRoute("/acme/widget/actions/runs/1/attempts/2")?.kind).toBe(
      "jobs",
    );
    expect(parseRoute("/acme/widget/actions/runs/1/attempts/0")).toBeNull();
    expect(parseRoute("/acme/widget/issues")).toBeNull();
    expect(parseRoute("/acme/widget/actions/secrets")).toBeNull();
    expect(parseRoute("/acme/widget/actions/runs/nope")).toBeNull();
  });
  it("reads actual list semantics without GitHub's generated CSS classes", () => {
    document.body.innerHTML = `<ul>${row("123")}</ul>`;
    const surface = readSurface(document, location);
    expect(surface?.items[0]).toMatchObject({
      title: "Update widget",
      status: "success",
      workflow: "Build and Test",
      number: "123",
      branch: "main",
      actor: "octocat",
      duration: "2m 5s",
      url: "https://github.com/acme/widget/actions/runs/123",
    });
    expect(surface?.nativeList).toBe(document.querySelector("ul"));
  });
  it("rejects foreign, cross-repository, executable and duplicate URLs", () => {
    document.body.innerHTML = `<ul>${row("1")}${row("1")}
      <li><a href="https://evil.example/acme/widget/actions/runs/2">spoof</a></li>
      <li><a href="/other/repo/actions/runs/2">foreign</a></li>
      <li><a href="javascript:alert(1)">bad</a></li></ul>`;
    expect(readSurface(document, location)?.items).toHaveLength(1);
  });
  it("fails open when rows are not in a single recognized container", () => {
    document.body.innerHTML = `<div><a href="/acme/widget/actions/runs/1">unknown markup</a></div>`;
    expect(readSurface(document, location)).toBeNull();
    document.body.innerHTML = `<ul>${row("1")}</ul><ul>${row("2")}</ul>`;
    expect(readSurface(document, location)).toBeNull();
  });
  it("reads deduplicated job links only for the current run", () => {
    document.body.innerHTML = `<main><nav>
      <a href="/acme/widget/actions/runs/1/job/2"><svg class="octicon octicon-x-circle-fill"></svg><span data-component="ActionList.Item.Label">test (linux)</span></a>
      <a href="/acme/widget/actions/runs/1/job/2">test duplicate</a>
      <a href="/acme/widget/actions/runs/3/job/4">other run</a></nav></main>`;
    const surface = readSurface(
      document,
      new URL("https://github.com/acme/widget/actions/runs/1"),
    );
    expect(surface?.items).toHaveLength(1);
    expect(surface?.items[0]).toMatchObject({
      title: "test (linux)",
      status: "failure",
    });
    expect(surface?.nativeList).toBeNull();
  });
  it.each([
    ["x-circle-fill", "failure"],
    ["check-circle-fill", "success"],
    ["alert", "action_required"],
    ["sync", "in_progress"],
    ["clock", "queued"],
    ["skip", "skipped"],
    ["circle-slash", "cancelled"],
    ["mystery", "unknown"],
  ])("recognizes %s as %s", (icon, status) => {
    const element = document.createElement("div");
    element.innerHTML = `<svg class="octicon octicon-${icon}"></svg>`;
    expect(readStatus(element)).toBe(status);
  });
  it("uses the base run's native job links on canonical attempt pages", () => {
    document.body.innerHTML = `<nav><a href="/acme/widget/actions/runs/1/job/2">test</a><a href="/acme/widget/actions/runs/3/job/4">other run</a></nav>`;
    expect(
      readSurface(
        document,
        new URL("https://github.com/acme/widget/actions/runs/1/attempts/2"),
      )?.items.map((item) => item.id),
    ).toEqual(["/acme/widget/actions/runs/1/job/2"]);
  });
  it("reuses durations from native graph jobs by exact URL, never by job name", () => {
    document.body.innerHTML = `<nav>
      <a href="/acme/widget/actions/runs/1/job/2">test</a>
      <a href="/acme/widget/actions/runs/1/job/3">test</a>
      </nav><streaming-graph-job><a href="/acme/widget/actions/runs/1/job/2">
        <span data-target="streaming-graph-job.name">test</span>
        <div class="text-small color-fg-muted">2m 5s</div>
      </a></streaming-graph-job>
      <div data-actions-enhanced><streaming-graph-job><a href="/acme/widget/actions/runs/1/job/3">
        <div class="text-small color-fg-muted">99s</div>
      </a></streaming-graph-job></div>`;
    const surface = readSurface(
      document,
      new URL("https://github.com/acme/widget/actions/runs/1"),
    );
    expect(surface?.items.map((item) => item.duration)).toEqual(["2m 5s", ""]);
    const duration = document.querySelector("streaming-graph-job .text-small");
    if (duration) duration.textContent = "Action required";
    expect(
      readSurface(
        document,
        new URL("https://github.com/acme/widget/actions/runs/1"),
      )?.items[0]?.duration,
    ).toBe("");
  });
  it("restores original native display including priority", () => {
    const element = document.createElement("ul");
    element.style.setProperty("display", "grid", "important");
    const restore = filterNativeItems([{ id: "1", element }], new Set());
    expect(element.style.display).toBe("none");
    restore();
    expect(element.style.display).toBe("grid");
    expect(element.style.getPropertyPriority("display")).toBe("important");
  });
  it("does not mistake run titles or stopwatch labels for status or duration", () => {
    document.body.innerHTML = `<ul><li aria-label="Run 123 of CI. Fix failed test">
      <a href="/acme/widget/actions/runs/123">Fix failed test</a>
      <span><svg class="octicon octicon-stopwatch"></svg>Action required</span>
      </li></ul>`;
    expect(readSurface(document, location)?.items[0]).toMatchObject({
      status: "unknown",
      duration: "",
    });
  });
});

describe("local filtering", () => {
  const base: Item = {
    id: "1",
    url: "https://github.com/acme/widget/actions/runs/1",
    title: "Fix build",
    status: "success",
    workflow: "CI",
    number: "1",
    branch: "main",
    actor: "octocat",
    duration: "",
    timestamp: "",
  };
  const items = [
    base,
    { ...base, id: "2", title: "Test matrix", status: "failure" as const },
  ];
  it("combines multi-term search, status and workflow without mutating input", () => {
    expect(
      filterItems(items, "matrix octocat", "attention", "CI", true).map(
        ({ id }) => id,
      ),
    ).toEqual(["2"]);
    expect(filterItems(items, "", "all", "", true).map(({ id }) => id)).toEqual(
      ["2", "1"],
    );
    expect(items[0]?.id).toBe("1");
    expect(filterItems(items, "", "active", "", false)).toEqual([]);
    expect(filterItems(items, "", "all", "Deploy", false)).toEqual([]);
  });
});
