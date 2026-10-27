// @vitest-environment-options {"url":"https://github.com/"}
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunViews } from "../entrypoints/actions.content/RunViews";
import { type Item, readSurface, type Surface } from "../lib/github";
import {
  cachedJobSteps,
  type JobStep,
  RUNNING_STEPS_TTL,
  requestJobSteps,
} from "../lib/job-steps";
import { jobHref, runViewHref } from "../lib/run-url";
import {
  durationSeconds,
  readJobRows,
  readNativeSections,
  sortJobRows,
  stableJobOrder,
} from "../lib/run-views";

const summary = "https://github.com/acme/widget/actions/runs/102";
vi.mock("../lib/job-steps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/job-steps")>()),
  requestJobSteps: vi.fn(),
  cachedJobSteps: vi.fn(),
}));
const step = (
  number: number,
  name: string,
  duration: string | null,
  status = "success",
): JobStep => ({
  number,
  name,
  duration,
  status,
  startedAt: null,
  completedAt: null,
});
const jobSteps = (url: URL) =>
  url.pathname.endsWith("/11")
    ? [step(1, "Set up job", "1s"), step(2, "Build", "2m", "failure")]
    : [step(1, "Set up job", null), step(2, "Test", "5s")];
beforeEach(() => {
  vi.mocked(cachedJobSteps).mockReset();
  vi.mocked(requestJobSteps).mockReset();
  vi.mocked(requestJobSteps).mockImplementation(async (url) => jobSteps(url));
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const markup = () => `<main>
  <h1>Native run title</h1>
  <nav aria-label="Workflow run"><a href="/acme/widget/actions/runs/102">Summary</a><ul>
    <li><a href="/acme/widget/actions/runs/102/job/11"><span data-component="ActionList.Item.Label">build (linux)</span></a><span><svg class="octicon-stopwatch"></svg>2m 5s</span></li>
    <li><a href="/acme/widget/actions/runs/102/job/12"><span data-component="ActionList.Item.Label">test (Windows)</span></a></li>
  </ul></nav>
  <div role="region" aria-label="Workflow run graph"><action-graph>Native graph</action-graph></div>
  <div role="region" aria-label="Annotations"><annotation-message>Real native notice</annotation-message></div>
  <section id="native-logs">Native logs</section><button>Re-run jobs</button>
  </main>`;

let root: Root | undefined;
const render = async (href = summary, initial?: Surface) => {
  window.history.replaceState({}, "", href);
  if (!initial) document.body.innerHTML = markup();
  const surface = initial ?? readSurface(document, new URL(href));
  if (!surface) throw new Error("Missing test surface");
  const mount = document.createElement("div");
  mount.dataset.actionsEnhanced = "run-experience";
  document.querySelector("main")?.prepend(mount);
  root = createRoot(mount);
  await act(async () => root?.render(createElement(RunViews, { surface })));
  return surface;
};
const navigate = async (view: string) => {
  await act(async () => {
    window.history.pushState({}, "", `${summary}?ae_view=${view}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
};
const click = async (label: string) => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
};
const tableNames = () =>
  Array.from(document.querySelectorAll("tbody tr a")).map(
    (link) => link.textContent,
  );
const tableJobs = () =>
  Array.from(document.querySelectorAll("tbody tr td:first-child")).map(
    (cell) => cell.textContent,
  );

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native run views adapter", () => {
  it("uses public Workflow run graph and Annotations region semantics", () => {
    document.body.innerHTML = markup();
    const sections = readNativeSections(document, new URL(summary));
    expect(sections.graph?.getAttribute("aria-label")).toBe(
      "Workflow run graph",
    );
    expect(sections.annotationsState).toBe("present");
    expect(
      sections.annotations?.querySelector("annotation-message")?.textContent,
    ).toBe("Real native notice");
  });

  it("recognizes the native action-graph element without a surrounding region", () => {
    document.body.innerHTML = "<action-graph>Existing graph</action-graph>";
    expect(readNativeSections(document, new URL(summary)).graph?.tagName).toBe(
      "ACTION-GRAPH",
    );
  });

  it("ignores extension-owned sections and distinguishes absent from explicit empty annotations", () => {
    document.body.innerHTML = `<div data-actions-enhanced="run-experience"><div role="region" aria-label="Annotations">No annotations</div><action-graph>Fake graph</action-graph></div>`;
    expect(readNativeSections(document, new URL(summary))).toMatchObject({
      graph: null,
      annotations: null,
      annotationsState: "unavailable",
    });
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="region" aria-label="Annotations">No annotations</div>',
    );
    expect(
      readNativeSections(document, new URL(summary)).annotationsState,
    ).toBe("empty");
    readNativeSections(
      document,
      new URL(summary),
    ).annotations?.insertAdjacentHTML(
      "beforeend",
      "<annotation-message>notice</annotation-message>",
    );
    expect(
      readNativeSections(document, new URL(summary)).annotationsState,
    ).toBe("present");
  });

  it("offers a real summary navigation fallback only on a job route", () => {
    document.body.innerHTML = markup();
    expect(
      readNativeSections(document, new URL(`${summary}/job/12`))
        .summaryNavigation,
    ).toBe(true);
    expect(
      readNativeSections(document, new URL(summary)).summaryNavigation,
    ).toBe(false);
    document
      .querySelector('a[href$="/102"]')
      ?.setAttribute("href", "/other/repo/actions/runs/102");
    expect(
      readNativeSections(document, new URL(`${summary}/job/12`))
        .summaryNavigation,
    ).toBe(false);
  });

  it.each([
    ["2m 5s", 125],
    ["1h 2m", 3720],
    ["0s", 0],
    ["", null],
    ["Unknown", null],
    ["2 minutes", null],
    ["12:35", null],
    ["job (20s)", null],
  ])("parses reliable compact duration %s as %s", (duration, seconds) => {
    expect(durationSeconds(duration)).toBe(seconds);
  });

  it("reads only scoped stopwatch metadata, never durations inferred from job names", () => {
    document.body.innerHTML = markup();
    const surface = readSurface(document, new URL(summary));
    if (!surface) throw new Error("Missing jobs");
    surface.items[1] = { ...(surface.items[1] as Item), title: "job (20s)" };
    const rows = readJobRows(surface);
    expect(rows.map(({ seconds }) => seconds)).toEqual([125, null]);
    expect(
      sortJobRows(rows, { column: "duration", direction: "descending" }).map(
        ({ seconds }) => seconds,
      ),
    ).toEqual([125, null]);
    expect(stableJobOrder([surface.items[1]?.id ?? ""], rows)).toEqual([
      surface.items[1]?.id,
      surface.items[0]?.id,
    ]);
  });

  it("preserves view and selected context in real navigation URLs", () => {
    const current = new URL(`${summary}/job/12?ae_view=table`);
    const annotations = new URL(runViewHref("annotations", current));
    expect(annotations.pathname).toBe("/acme/widget/actions/runs/102");
    expect(annotations.searchParams.get("ae_job")).toBe("12");
    expect(
      new URL(jobHref(`${summary}/job/11`, annotations)).searchParams.get(
        "ae_view",
      ),
    ).toBe("annotations");
    expect(
      new URL(jobHref(`${summary}/job/11`, annotations)).searchParams.has(
        "ae_job",
      ),
    ).toBe(false);
  });
});

describe("RunViews native-first UI", () => {
  it("paginates steps in batches of 100 without a caption and sorts the full dataset", async () => {
    vi.mocked(requestJobSteps).mockResolvedValue(
      Array.from({ length: 125 }, (_, index) =>
        step(index + 1, `Step ${index + 1}`, "1s"),
      ),
    );
    await render(`${summary}?ae_view=table`);
    expect(document.querySelector("caption")).toBeNull();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(100);
    await click("Next");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(100);
    await click("Next");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(50);
    await click("Step");
    expect(
      document.querySelector(".ae-table-pagination")?.textContent,
    ).toContain("1 / 3");
    expect(tableNames()[0]).toBe("Step 1");
    expect(tableNames()[1]).toBe("Step 1");
  });
  it("defaults to native List without a replacement table or future tabs", async () => {
    await render();
    const nav = document.querySelector('nav[aria-label="Run views"]');
    expect(nav?.textContent).toBe("ListTableGraph1");
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe(
      "List",
    );
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector("#native-logs")?.textContent).toBe(
      "Native logs",
    );
    expect(document.querySelector("h1")?.textContent).toBe("Native run title");
  });

  it("automatically flattens every step with job context and sortable native step links", async () => {
    await render(`${summary}?ae_view=table&ae_job=12`);
    expect(document.querySelector("caption")).toBeNull();
    expect(tableNames()).toEqual(["Set up job", "Build", "Set up job", "Test"]);
    expect(tableJobs()).toEqual([
      "build (linux)",
      "build (linux)",
      "test (Windows)",
      "test (Windows)",
    ]);
    expect(
      Array.from(document.querySelectorAll("thead th")).map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Job", "Step", "Status", "Duration"]);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(
      document.querySelector("tbody [aria-expanded], tbody ol, tbody details"),
    ).toBeNull();
    expect(document.querySelector('input[type="search"]')).toBeNull();
    expect(document.querySelector("tbody")?.textContent).toContain("Unknown");
    expect(document.querySelector("tbody a")?.getAttribute("href")).toBe(
      `${summary}/job/11?ae_view=table&ae_tab=log&ae_step=1`,
    );
    await click("Step");
    expect(
      document.querySelector('th[aria-sort="ascending"]')?.textContent,
    ).toContain("Step");
    expect(tableNames()).toEqual(["Build", "Set up job", "Set up job", "Test"]);
    await click("Step ↑");
    expect(tableNames()).toEqual(["Test", "Set up job", "Set up job", "Build"]);
    await click("Status");
    expect(tableNames()[0]).toBe("Build");
    await click("Duration");
    expect(tableNames()).toEqual(["Set up job", "Test", "Build", "Set up job"]);
    await click("Duration ↑");
    expect(tableNames()).toEqual(["Build", "Test", "Set up job", "Set up job"]);
    await click("Job");
    expect(tableJobs()).toEqual([
      "build (linux)",
      "build (linux)",
      "test (Windows)",
      "test (Windows)",
    ]);
    expect(requestJobSteps).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".ae-job-controls")).toBeNull();
    expect(document.querySelector(".ae-job-controls-menu")).toBeNull();
    expect(document.querySelector("#native-logs")?.isConnected).toBe(true);
  });

  it("hides skipped steps from the flat table", async () => {
    vi.mocked(requestJobSteps).mockResolvedValue([
      step(1, "Visible setup", "1s"),
      step(2, "Skipped test", null, "skipped"),
      step(3, "Visible cleanup", "1s"),
    ]);
    await render(`${summary}?ae_view=table`);
    expect(tableNames()).toEqual([
      "Visible setup",
      "Visible cleanup",
      "Visible setup",
      "Visible cleanup",
    ]);
    expect(document.querySelector("tbody")?.textContent).not.toContain(
      "Skipped test",
    );
  });

  it("keeps every loaded job visible without adding custom filter or display controls", async () => {
    const surface = await render(`${summary}?ae_view=table`);
    const updated: Surface = {
      ...surface,
      items: surface.items.map((item, index) => ({
        ...item,
        status: index === 0 ? "failure" : "success",
      })),
    };
    await act(async () =>
      root?.render(createElement(RunViews, { surface: updated })),
    );
    expect(document.querySelector(".ae-job-controls")).toBeNull();
    expect(document.querySelectorAll(".ae-run-table-group")).toHaveLength(0);
    expect(document.querySelector("tbody")?.textContent).toContain("Failed");
    expect(document.querySelector("tbody")?.textContent).toContain("Passed");
    expect(tableNames()).toEqual(["Set up job", "Build", "Set up job", "Test"]);
    expect(requestJobSteps).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll("[data-ae-filtered-job]")).toHaveLength(0);
  });

  it("defaults to All except skipped inside the native filter and preserves All", async () => {
    document.body.innerHTML = markup();
    document
      .querySelector("nav")
      ?.insertAdjacentHTML(
        "beforeend",
        '<button aria-labelledby="filter-label" aria-expanded="true">Filter</button><span id="filter-label">Filter by job status</span>',
      );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<ul id="native-all" role="menu" aria-labelledby="filter-label">
      <li role="menuitemradio" aria-checked="true" id="all-option"><span data-component="ActionList.Item.Label" id="all-label">All</span><span data-component="ActionList.TrailingVisual">2 (2)</span></li></ul>`,
    );
    const all = document.getElementById("all-option");
    if (!all) throw new Error("Missing All option");
    all.addEventListener("click", () =>
      all.setAttribute("aria-checked", "true"),
    );
    const surface = readSurface(document, new URL(summary));
    if (!surface) throw new Error("Missing test surface");
    const updated: Surface = {
      ...surface,
      items: surface.items.map((item, index) => ({
        ...item,
        status: index === 0 ? "skipped" : "success",
      })),
    };
    await render(`${summary}?ae_view=table`, updated);
    expect(tableJobs()).toEqual(["test (Windows)", "test (Windows)"]);
    expect(document.querySelectorAll("[data-ae-filtered-job]")).toHaveLength(1);
    const excluded = document.querySelector("[data-ae-exclude-skipped]");
    expect(excluded?.getAttribute("aria-checked")).toBe("true");
    expect(all.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector(".ae-show-skipped")).toBeNull();
    await act(async () => all.click());
    expect(tableJobs()).toHaveLength(4);
    expect(document.querySelectorAll("[data-ae-filtered-job]")).toHaveLength(0);
    await navigate("summary");
    expect(
      document
        .querySelector("[data-ae-exclude-skipped]")
        ?.getAttribute("aria-checked"),
    ).toBe("false");
    await act(async () =>
      document.querySelector<HTMLElement>("[data-ae-exclude-skipped]")?.click(),
    );
    expect(document.querySelectorAll("[data-ae-filtered-job]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-ae-exclude-skipped]")).toHaveLength(
      1,
    );
    expect(
      document
        .querySelector("[data-ae-exclude-skipped]")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("honors an explicit native Skipped filter with Primer counter markup", async () => {
    document.body.innerHTML = markup();
    document
      .querySelector("nav")
      ?.insertAdjacentHTML(
        "beforeend",
        '<button aria-label="Filter by job status" aria-controls="native-skipped">Filter</button>',
      );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<ul id="native-skipped" role="menu">
      <li role="menuitemradio" aria-checked="true"><span data-component="ActionList.Item.Label">Skipped</span><span>34</span><span> (34)</span></li>
      </ul>`,
    );
    const surface = readSurface(document, new URL(summary));
    if (!surface) throw new Error("Missing test surface");
    await render(`${summary}?ae_view=table`, {
      ...surface,
      items: surface.items.map((item, index) => ({
        ...item,
        status: index === 0 ? "skipped" : "success",
      })),
    });
    expect(tableJobs()).toEqual(["build (linux)", "build (linux)"]);
  });

  it("uses the native status popup when present and mirrors its selected state", async () => {
    document.body.innerHTML = markup();
    document
      .querySelector('nav[aria-label="Workflow run"]')
      ?.insertAdjacentHTML(
        "beforeend",
        `<button aria-label="Filter by job status" aria-haspopup="true"
          aria-controls="native-job-filter">Filter</button>`,
      );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="native-job-filter" role="menu">
        <label><input type="radio" name="native-state" value="failure" checked>Failed (1)</label>
        <label><input type="radio" name="native-state" value="success">Passed (1)</label>
      </div>`,
    );
    const surface = readSurface(document, new URL(`${summary}?ae_view=table`));
    if (!surface) throw new Error("Missing test surface");
    const updated: Surface = {
      ...surface,
      items: surface.items.map((item, index) => ({
        ...item,
        status: index === 0 ? "failure" : "success",
      })),
    };
    await render(`${summary}?ae_view=table`, updated);
    expect(
      document
        .querySelector(
          'nav[aria-label="Workflow run"] button[aria-label="Filter by job status"]',
        )
        ?.hasAttribute("data-ae-native-job-filter"),
    ).toBe(true);
    expect(document.querySelector(".ae-job-controls")).toBeNull();
    expect(document.querySelector(".ae-job-controls-menu")).toBeNull();
    expect(tableNames()).toEqual(["Set up job", "Build"]);
    expect(tableJobs()).toEqual(["build (linux)", "build (linux)"]);
    expect(document.querySelectorAll("[data-ae-filtered-job]")).toHaveLength(1);

    const failure = document.querySelector<HTMLInputElement>(
      'input[name="native-state"][value="failure"]',
    );
    const success = document.querySelector<HTMLInputElement>(
      'input[name="native-state"][value="success"]',
    );
    if (!failure || !success) throw new Error("Missing native state options");
    await act(async () => {
      failure.checked = false;
      success.checked = true;
      success.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(tableNames()).toEqual(["Set up job", "Test"]);
    expect(tableJobs()).toEqual(["test (Windows)", "test (Windows)"]);
    expect(requestJobSteps).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll("[data-ae-filtered-job]")).toHaveLength(1);
  });

  it("always offers run-detail tabs in the workspace with counters from native slots", async () => {
    document.body.innerHTML = `${markup()}
      <div data-ae-workspace>
        <section data-ae-native-section="run-summary"></section>
        <section data-ae-native-section="annotations">
          <annotation-message>one</annotation-message>
          <annotation-message>two</annotation-message>
        </section>
        <section data-ae-native-section="artifacts">
          <table><tbody>
            <tr><td><a href="/acme/widget/actions/runs/102/artifacts/1">one</a></td></tr>
            <tr><td><a href="/acme/widget/actions/runs/102/artifacts/2">two</a></td></tr>
          </tbody></table>
        </section>
      </div>`;
    const surface = readSurface(document, new URL(summary));
    if (!surface) throw new Error("Missing test surface");
    await render(summary, surface);
    const tabs = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'nav[aria-label="Run views"] a',
      ),
    );
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Summary",
      "List",
      "Table",
      "Graph",
      "2",
      "Artifacts2",
    ]);
    expect(
      tabs.find((tab) => tab.getAttribute("aria-label") === "Annotations")
        ?.href,
    ).toContain("ae_view=annotations");
    expect(
      tabs.find((tab) => tab.textContent?.includes("Artifacts"))?.href,
    ).toContain("ae_view=artifacts");
    expect(document.querySelector(".ae-job-controls")).toBeNull();

    await navigate("artifacts");
    expect(document.querySelector(".ae-job-controls")).toBeNull();
    expect(document.querySelector("#native-logs")?.isConnected).toBe(true);
  });

  it("keeps all run-detail tabs available when their native slots are empty", async () => {
    document.body.innerHTML = `${markup()}<div data-ae-workspace>
      <section data-ae-native-section="run-summary"></section>
      <section data-ae-native-section="annotations"><h2>Annotations</h2><p>No annotations</p></section>
      <section data-ae-native-section="artifacts"></section>
    </div>`;
    const surface = readSurface(document, new URL(summary));
    if (!surface) throw new Error("Missing test surface");
    await render(summary, surface);
    const nav = document.querySelector('nav[aria-label="Run views"]');
    expect(nav?.textContent).toBe("SummaryListTableGraph0Artifacts0");
  });

  it("uses the native annotation summary count rather than only rendered messages", async () => {
    document.body.innerHTML = `${markup()}<div data-ae-workspace>
      <section data-ae-native-section="annotations">
        <h2>Annotations</h2><p>3 errors and 4 warnings</p>
        <annotation-message>Only one rendered message</annotation-message>
      </section>
    </div>`;
    const surface = readSurface(document, new URL(summary));
    if (!surface) throw new Error("Missing test surface");
    await render(summary, surface);
    const tab = document.querySelector('a[href*="ae_view=annotations"]');
    expect(tab?.querySelector('[aria-label="3 errors"]')?.textContent).toBe(
      "3",
    );
    expect(tab?.querySelector('[aria-label="4 warnings"]')?.textContent).toBe(
      "4",
    );
    expect(tab?.querySelectorAll(".ae-annotation-count")).toHaveLength(2);
    expect(tab?.querySelector(".CounterLabel")).toBeNull();
    expect(tab?.textContent).not.toContain("Annotations");
  });

  it("keeps focused sort controls and loaded steps as live job metadata changes", async () => {
    const surface = await render(`${summary}?ae_view=table`);
    await click("Job");
    const button = document.querySelector<HTMLButtonElement>("th button");
    button?.focus();
    const updated: Surface = {
      ...surface,
      items: surface.items.map((item, index) => ({
        ...item,
        title: index === 0 ? "zzz live" : "aaa live",
        status: "in_progress",
      })),
    };
    await act(async () =>
      root?.render(createElement(RunViews, { surface: updated })),
    );
    expect(document.activeElement).toBe(button);
    expect(tableJobs()).toEqual([
      "aaa live",
      "aaa live",
      "zzz live",
      "zzz live",
    ]);
    expect(requestJobSteps).toHaveBeenCalledTimes(2);
    await click("Job ↑");
    expect(tableJobs()).toEqual([
      "zzz live",
      "zzz live",
      "aaa live",
      "aaa live",
    ]);
  });

  it("preserves attempt and table context while targeting the selected native step", async () => {
    await render(
      `${summary}/job/12?attempt=3&ae_view=table&ae_tab=details&ae_step=2`,
    );
    const link = document.querySelector<HTMLAnchorElement>(
      'tbody a[aria-current="page"]',
    );
    expect(link?.textContent).toBe("Test");
    const url = new URL(link?.href ?? summary);
    expect(url.pathname).toBe("/acme/widget/actions/runs/102/job/12");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      attempt: "3",
      ae_view: "table",
      ae_tab: "log",
      ae_step: "2",
    });
    expect(
      vi.mocked(requestJobSteps).mock.calls.map(([url]) => url.search),
    ).toEqual(["?attempt=3", "?attempt=3"]);
    await act(async () => {
      window.history.replaceState(
        {},
        "",
        `${summary}/job/11?attempt=3&ae_view=table&ae_step=1`,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(requestJobSteps).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector('tbody a[aria-current="page"]')?.textContent,
    ).toBe("Set up job");
  });

  it("shows individual loading and failure rows and retries only the failed job", async () => {
    let finish: ((steps: JobStep[]) => void) | undefined;
    vi.mocked(requestJobSteps).mockImplementation((url) =>
      url.pathname.endsWith("/11")
        ? Promise.reject(new Error("Job steps unavailable"))
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const surface = await render(`${summary}?ae_view=table`);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Job steps unavailable",
    );
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Loading steps…",
    );
    expect(tableNames()).toEqual([]);
    await act(async () =>
      root?.render(createElement(RunViews, { surface: { ...surface } })),
    );
    expect(requestJobSteps).toHaveBeenCalledTimes(2);
    vi.mocked(requestJobSteps).mockResolvedValueOnce([
      step(1, "Recovered step", "0s"),
    ]);
    await click("Retry");
    expect(tableNames()).toEqual(["Recovered step"]);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(requestJobSteps).toHaveBeenCalledTimes(3);
    await act(async () => finish?.([step(1, "Other job step", "1s")]));
    expect(tableNames()).toEqual(["Recovered step", "Other job step"]);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("treats a parsed job with no steps as empty rather than an error", async () => {
    vi.mocked(requestJobSteps).mockResolvedValue([]);
    await render(`${summary}?ae_view=table`);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('button[aria-label^="Retry"]')).toBeNull();
  });

  it("sorts subsecond and timestamp-backed step durations before unknown durations", async () => {
    vi.mocked(requestJobSteps).mockImplementation(async (url) =>
      url.pathname.endsWith("/11")
        ? [
            step(1, "Short", "500ms"),
            {
              ...step(2, "Measured", "0s"),
              startedAt: 1000,
              completedAt: 1750,
            },
          ]
        : [step(1, "Unknown", null), step(2, "Long", "1s")],
    );
    await render(`${summary}?ae_view=table`);
    await click("Duration");
    expect(tableNames()).toEqual(["Short", "Measured", "Long", "Unknown"]);
    await click("Duration ↑");
    expect(tableNames()).toEqual(["Long", "Measured", "Short", "Unknown"]);
  });

  it("refreshes only unsettled steps at the existing cache interval", async () => {
    vi.useFakeTimers();
    vi.mocked(requestJobSteps)
      .mockResolvedValueOnce([step(1, "Running", null, "in_progress")])
      .mockResolvedValueOnce([step(1, "Finished", "1s")])
      .mockResolvedValueOnce([step(1, "Now finished", "2s")]);
    await render(`${summary}?ae_view=table`);
    expect(tableNames()).toEqual(["Running", "Finished"]);
    await act(async () => vi.advanceTimersByTimeAsync(RUNNING_STEPS_TTL - 1));
    expect(requestJobSteps).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(requestJobSteps).toHaveBeenCalledTimes(3);
    expect(tableNames()).toEqual(["Now finished", "Finished"]);
    await act(async () => vi.advanceTimersByTimeAsync(RUNNING_STEPS_TTL));
    expect(requestJobSteps).toHaveBeenCalledTimes(3);
  });

  it("starts all cache lookups without a table-level network queue", async () => {
    document.body.innerHTML = markup();
    const initial = readSurface(document, new URL(summary));
    if (!initial?.items[0]) throw new Error("Missing test surface");
    const template = initial.items[0];
    const surface: Surface = {
      ...initial,
      items: Array.from({ length: 8 }, (_, index) => ({
        ...template,
        id: `/acme/widget/actions/runs/102/job/${index + 11}`,
        url: `${summary}/job/${index + 11}`,
        title: `matrix (${index})`,
      })),
    };
    const pending: (() => void)[] = [];
    let active = 0;
    let maximum = 0;
    vi.mocked(requestJobSteps).mockImplementation(
      () =>
        new Promise((resolve) => {
          active++;
          maximum = Math.max(maximum, active);
          pending.push(() => {
            active--;
            resolve([step(1, "Set up job", "1s")]);
          });
        }),
    );
    await render(`${summary}?ae_view=table`, surface);
    expect(requestJobSteps).toHaveBeenCalledTimes(8);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(8);
    await act(async () => pending.shift()?.());
    expect(requestJobSteps).toHaveBeenCalledTimes(8);
    expect(maximum).toBe(8);
    expect(tableNames()).toEqual(["Set up job"]);
    await navigate("summary");
    await act(async () => pending.forEach((finish) => finish()));
    expect(requestJobSteps).toHaveBeenCalledTimes(8);
    expect(document.querySelector("table")).toBeNull();
  });

  it("renders memory-cached steps without a loading state or async lookup", async () => {
    vi.mocked(cachedJobSteps).mockImplementation((url) => jobSteps(url));
    await render(`${summary}?ae_view=table`);
    expect(tableNames()).toEqual(["Set up job", "Build", "Set up job", "Test"]);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(requestJobSteps).not.toHaveBeenCalled();
  });

  it("loads new job URLs and attempts without repeating unchanged requests", async () => {
    const surface = await render(`${summary}?ae_view=table`);
    const template = surface.items[0];
    if (!template) throw new Error("Missing test job");
    const updated: Surface = {
      ...surface,
      items: [
        ...surface.items,
        {
          ...template,
          id: "/acme/widget/actions/runs/102/job/13",
          url: `${summary}/job/13`,
          title: "build (macOS)",
        },
      ],
    };
    await act(async () =>
      root?.render(createElement(RunViews, { surface: updated })),
    );
    expect(requestJobSteps).toHaveBeenCalledTimes(3);
    expect(tableNames()).toHaveLength(6);
    await act(async () => {
      window.history.replaceState(
        {},
        "",
        `${summary}/attempts/2?ae_view=table`,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(requestJobSteps).toHaveBeenCalledTimes(6);
    expect(
      vi
        .mocked(requestJobSteps)
        .mock.calls.slice(3)
        .every(([url]) => url.searchParams.get("attempt") === "2"),
    ).toBe(true);
    expect(
      new URL(
        document.querySelector<HTMLAnchorElement>("tbody a")?.href ?? summary,
      ).searchParams.get("attempt"),
    ).toBe("2");
  });

  it("focuses native sections once per view URL, preserves identities and handles history", async () => {
    await render();
    const graph = document.querySelector<HTMLElement>(
      '[aria-label="Workflow run graph"]',
    );
    const annotations = document.querySelector(
      '[role="region"][aria-label="Annotations"]',
    );
    const focus = vi.spyOn(graph as HTMLElement, "focus");
    await navigate("graph");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(graph);
    expect(
      document.querySelector('[role="region"][aria-label="Annotations"]'),
    ).toBe(annotations);
    expect(document.querySelector("#native-logs")).not.toBeNull();
    await act(async () => {
      graph?.append(document.createTextNode("updated"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(focus).toHaveBeenCalledTimes(1);
    await act(async () => {
      const replacement = graph?.cloneNode(true);
      if (replacement) graph?.replaceWith(replacement);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.activeElement).not.toBe(
      document.querySelector('[aria-label="Workflow run graph"]'),
    );
    await navigate("summary");
    expect(graph?.hasAttribute("tabindex")).toBe(false);
    await navigate("graph");
    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Workflow run graph"]'),
    );
  });

  it("updates run-detail tab availability from native sections without inventing content", async () => {
    await render(`${summary}?ae_view=annotations`);
    const nav = document.querySelector('nav[aria-label="Run views"]');
    expect(nav?.querySelector('a[href*="ae_view=annotations"]')).not.toBeNull();
    await act(async () => {
      document
        .querySelector('[role="region"][aria-label="Annotations"]')
        ?.remove();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(nav?.querySelector('a[href*="ae_view=annotations"]')).toBeNull();
    expect(
      document.querySelector('[data-actions-enhanced="run-views"]')
        ?.textContent,
    ).not.toContain("reports no annotations");
    await act(async () => {
      document
        .querySelector("main")
        ?.insertAdjacentHTML(
          "beforeend",
          '<div role="region" aria-label="Annotations">No annotations</div>',
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(nav?.querySelector('a[href*="ae_view=annotations"]')).not.toBeNull();
    expect(
      document.querySelector('[data-actions-enhanced="run-views"]')
        ?.textContent,
    ).not.toContain("GitHub reports no annotations.");
  });

  it("adds Waterfall only for available content and keeps real anchors unmodified", async () => {
    const surface = await render();
    await act(async () =>
      root?.render(
        createElement(RunViews, {
          surface,
          waterfallAvailable: true,
          waterfall: createElement(
            "div",
            { id: "timing-panel" },
            "Measured timing",
          ),
        }),
      ),
    );
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href*="ae_view=waterfall"]',
    );
    expect(link?.textContent).toBe("Waterfall");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    expect(link?.dispatchEvent(event)).toBe(true);
    await navigate("waterfall");
    expect(document.querySelector("#timing-panel")?.textContent).toBe(
      "Measured timing",
    );
  });
});
