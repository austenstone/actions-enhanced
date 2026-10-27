// @vitest-environment-options {"url":"https://github.com/acme/widget/actions/runs/102?ae_view=table"}
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobStepList } from "../entrypoints/actions.content/JobSteps";
import { WaterfallTimeline } from "../entrypoints/actions.content/WaterfallTimeline";
import {
  clearJobStepsCache,
  JobStepsError,
  jobStepHref,
  RUNNING_STEPS_TTL,
  readNativeJobSteps,
  requestJobSteps,
} from "../lib/job-steps";
import type { JobTiming } from "../lib/job-timing";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const run = "https://github.com/acme/widget/actions/runs/102";
const step = (
  number: number,
  name: string,
  { conclusion = "success", duration = "2s" } = {},
) => `<details class="js-checks-log-details" id="check-step-${number}" data-step-number="${number}"${conclusion ? ` data-conclusion="${conclusion}"` : ""}>
  <summary class="js-check-step-summary">
    <span class="CheckStep-title"><span class="CheckStep-titleName">${name}</span></span>
    <span class="text-mono text-normal text-small float-right">${duration}</span>
  </summary>
  <div class="js-full-logs-container" data-log-url="/private/log"><pre>SECRET=do-not-read</pre></div>
</details>`;
const page = (steps: string, extra = "") =>
  `<html><body>${extra}<section aria-label="Check run summary"><div class="CheckRun js-check-steps">${steps}</div></section></body></html>`;
const serverStep = (
  number: number,
  name: string,
  conclusion: string,
  startedAt: string,
  completedAt: string,
) => `<check-step
  data-name="${name}"
  data-number="${number}"
  data-conclusion="${conclusion}"
  data-external-id="ext-${number}"
  data-started-at="${startedAt}"
  data-completed-at="${completedAt}"
  data-log-url="/acme/widget/commit/abc/checks/11/logs/${number}"
  data-job-completed data-use-actions-ux></check-step>`;
const serverPage = (steps: string) => `<html><body>
  <section aria-label="Check run summary" class="js-selected-check-run"><div class="js-check-steps"><check-steps>${steps}</check-steps></div></section>
  <section aria-label="Check run summary" class="js-zen-blankslate" hidden><check-step data-name="Blankslate" data-number="1"></check-step></section>
</body></html>`;
const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, ...init });
const parse = (markup: string) =>
  new DOMParser().parseFromString(markup, "text/html");

let root: Root | undefined;

beforeEach(() => {
  clearJobStepsCache();
  window.history.replaceState({}, "", `${run}?ae_view=table`);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.stubGlobal("chrome", undefined);
  vi.useRealTimers();
});

describe("readNativeJobSteps", () => {
  it("reads only visible Check run summary headers", () => {
    const doc = parse(
      page(
        `${step(1, "Set up job")}${step(2, "Run tests", { conclusion: "failure", duration: "1m 3s" })}${step(3, "Deploy", { conclusion: "skipped", duration: "" })}`,
        `<section aria-label="Check run summary" hidden><div class="js-check-steps">${step(9, "Stale")}</div></section>
         <div data-actions-enhanced="x"><section aria-label="Check run summary">${step(8, "Ours")}</section></div>`,
      ),
    );
    const steps = readNativeJobSteps(doc);
    expect(steps).toEqual([
      {
        number: 1,
        name: "Set up job",
        status: "success",
        duration: "2s",
        startedAt: null,
        completedAt: null,
      },
      {
        number: 2,
        name: "Run tests",
        status: "failure",
        duration: "1m 3s",
        startedAt: null,
        completedAt: null,
      },
      {
        number: 3,
        name: "Deploy",
        status: "skipped",
        duration: null,
        startedAt: null,
        completedAt: null,
      },
    ]);
    expect(JSON.stringify(steps)).not.toMatch(/SECRET|private\/log/);
  });

  it("reads server-rendered check-step attributes from a fetched job page", () => {
    const steps = readNativeJobSteps(
      parse(
        serverPage(
          `${serverStep(1, "Set up job", "success", "2026-10-26T13:42:39Z", "2026-10-26T13:42:39Z")}
           ${serverStep(3, "Run Dependabot", "failure", "2026-10-26T13:42:39Z", "2026-10-26T13:44:24Z")}
           ${serverStep(4, "Upload", "", "2026-10-26T13:44:24Z", "")}
           ${serverStep(5, "Complete job", "", "", "")}`,
        ),
      ),
    );
    expect(steps).toEqual([
      {
        number: 1,
        name: "Set up job",
        status: "success",
        duration: "0s",
        startedAt: Date.parse("2026-10-26T13:42:39Z"),
        completedAt: Date.parse("2026-10-26T13:42:39Z"),
      },
      {
        number: 3,
        name: "Run Dependabot",
        status: "failure",
        duration: "1m 45s",
        startedAt: Date.parse("2026-10-26T13:42:39Z"),
        completedAt: Date.parse("2026-10-26T13:44:24Z"),
      },
      {
        number: 4,
        name: "Upload",
        status: "in_progress",
        duration: null,
        startedAt: Date.parse("2026-10-26T13:44:24Z"),
        completedAt: null,
      },
      {
        number: 5,
        name: "Complete job",
        status: "queued",
        duration: null,
        startedAt: null,
        completedAt: null,
      },
    ]);
    expect(JSON.stringify(steps)).not.toMatch(/logs|ext-/);
  });

  it("falls back to the summary icon for running steps", () => {
    const doc = parse(
      page(
        step(1, "Build", { conclusion: "", duration: "" }).replace(
          '<span class="CheckStep-title">',
          '<svg class="octicon octicon-dot-fill"></svg><span class="CheckStep-title">',
        ),
      ),
    );
    expect(readNativeJobSteps(doc)[0]).toMatchObject({
      number: 1,
      status: "in_progress",
      duration: null,
    });
  });
});

describe("jobStepHref", () => {
  it("targets the native log step and keeps view and attempt", () => {
    const href = jobStepHref(
      new URL(`${run}/job/11?attempt=2`),
      3,
      new URL(`${run}?ae_view=waterfall&ae_tab=details`),
    );
    const url = new URL(href);
    expect(url.pathname).toBe("/acme/widget/actions/runs/102/job/11");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      attempt: "2",
      ae_view: "waterfall",
      ae_tab: "log",
      ae_step: "3",
    });
  });
});

describe("requestJobSteps", () => {
  const jobUrl = new URL(`${run}/job/11?ae_view=table`);

  it("rejects jobs outside the current run or origin without fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const url of [
      "https://evil.example/acme/widget/actions/runs/102/job/11",
      "https://github.com/acme/widget/actions/runs/999/job/11",
      "https://github.com/other/widget/actions/runs/102/job/11",
      `${run}/job/abc`,
      `${run}/job/11/logs`,
    ])
      await expect(
        requestJobSteps(new URL(url), { fetcher }),
      ).rejects.toMatchObject({ code: "invalid-url" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads the selected native job from the page without fetching", async () => {
    document.body.innerHTML = serverPage(
      serverStep(
        1,
        "Visible",
        "success",
        "2026-10-26T10:00:00Z",
        "2026-10-26T10:00:02Z",
      ),
    );
    window.history.replaceState({}, "", `${run}/job/11`);
    const fetcher = vi.fn<typeof fetch>();
    await expect(requestJobSteps(jobUrl, { fetcher })).resolves.toMatchObject([
      { name: "Visible" },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fills missing selected-job timestamps from the native job response", async () => {
    document.body.innerHTML = page(step(1, "Visible"));
    window.history.replaceState({}, "", `${run}/job/11?attempt=2`);
    const fetcher = vi.fn<typeof fetch>(async () =>
      html(
        serverPage(
          serverStep(
            1,
            "Visible",
            "success",
            "2026-10-26T10:00:00Z",
            "2026-10-26T10:00:02Z",
          ),
        ),
      ),
    );
    const steps = await requestJobSteps(new URL(`${run}/job/11?attempt=2`), {
      fetcher,
    });
    expect(steps[0]).toMatchObject({
      duration: "2s",
      startedAt: Date.parse("2026-10-26T10:00:00Z"),
      completedAt: Date.parse("2026-10-26T10:00:02Z"),
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${run}/job/11?attempt=2`);
  });

  it("fetches a non-selected job while another job is open", async () => {
    document.body.innerHTML = page(step(1, "Selected job step"));
    window.history.replaceState({}, "", `${run}/job/12?ae_view=table`);
    const fetcher = vi.fn<typeof fetch>(async () =>
      html(
        serverPage(
          serverStep(
            1,
            "Other job step",
            "success",
            "2026-10-26T13:42:39Z",
            "2026-10-26T13:42:40Z",
          ),
        ),
      ),
    );
    await expect(requestJobSteps(jobUrl, { fetcher })).resolves.toMatchObject([
      { number: 1, name: "Other job step", duration: "1s" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fetches same-origin native HTML once and reuses settled steps", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      html(page(step(1, "Setup"))),
    );
    const [first, second] = await Promise.all([
      requestJobSteps(jobUrl, { fetcher }),
      requestJobSteps(jobUrl, { fetcher }),
    ]);
    expect(first).toBe(second);
    expect(
      await requestJobSteps(jobUrl, { fetcher, now: Date.now() + 3_600_000 }),
    ).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://github.com/acme/widget/actions/runs/102/job/11",
      { credentials: "same-origin", headers: { Accept: "text/html" } },
    );
    await requestJobSteps(new URL(`${run}/job/11?attempt=2`), { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await requestJobSteps(new URL(`${run}/job/12?attempt=2`), { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("persists steps across page loads and view/attempt URL variants", async () => {
    const saved: Record<string, unknown> = {};
    const storage = {
      get: vi.fn(async (key: string | null) =>
        key === null ? { ...saved } : { [key]: saved[key] },
      ),
      set: vi.fn(async (entries: Record<string, unknown>) => {
        Object.assign(saved, entries);
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const key of keys) delete saved[key];
      }),
    };
    vi.stubGlobal("chrome", { storage: { local: storage } });
    const fetcher = vi.fn<typeof fetch>(async () =>
      html(page(step(1, "Cached step"))),
    );
    await requestJobSteps(jobUrl, { fetcher });
    clearJobStepsCache();
    window.history.replaceState({}, "", `${run}?ae_view=waterfall`);
    await expect(
      requestJobSteps(new URL(`${run}/job/11?attempt=1&ae_view=waterfall`), {
        fetcher,
      }),
    ).resolves.toMatchObject([{ name: "Cached step" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(saved)).not.toContain("SECRET");
  });

  it("caches selected native steps for other pages", async () => {
    const saved: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => saved,
          set: async (entries: Record<string, unknown>) =>
            Object.assign(saved, entries),
          remove: async () => {},
        },
      },
    });

    document.body.innerHTML = serverPage(
      serverStep(
        1,
        "Native cached",
        "success",
        "2026-10-26T10:00:00Z",
        "2026-10-26T10:00:02Z",
      ),
    );
    window.history.replaceState({}, "", `${run}/job/11?attempt=1`);
    const fetcher = vi.fn<typeof fetch>();
    await requestJobSteps(jobUrl, { fetcher });
    clearJobStepsCache();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", `${run}?ae_view=table`);
    await expect(requestJobSteps(jobUrl, { fetcher })).resolves.toMatchObject([
      { name: "Native cached" },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps more than 50 completed jobs without refetching", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      html(page(step(1, "Cached"))),
    );
    for (let id = 1; id <= 75; id++)
      await requestJobSteps(new URL(`${run}/job/${id}`), { fetcher });
    await requestJobSteps(new URL(`${run}/job/1`), { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(75);
  });

  it("reuses completed steps for 30 days then expires them", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const saved: Record<string, unknown> = {};
    const remove = vi.fn(async (keys: string[]) => {
      for (const key of keys) delete saved[key];
    });
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => ({ ...saved }),
          set: async (entries: Record<string, unknown>) =>
            Object.assign(saved, entries),
          remove,
        },
      },
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      html(page(step(1, "Cached"))),
    );
    await requestJobSteps(jobUrl, { fetcher });
    clearJobStepsCache();
    vi.setSystemTime(start + 29 * day);
    await requestJobSteps(jobUrl, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    clearJobStepsCache();
    vi.setSystemTime(start + 30 * day);
    await requestJobSteps(jobUrl, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalled();
  });

  it("shares rate-limit cooldown across jobs and page loads", async () => {
    const saved: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => saved,
          set: async (entries: Record<string, unknown>) =>
            Object.assign(saved, entries),
          remove: async () => {},
        },
      },
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      html("", { status: 429, headers: { "retry-after": "120" } }),
    );
    await expect(requestJobSteps(jobUrl, { fetcher })).rejects.toMatchObject({
      code: "rate-limit",
    });
    clearJobStepsCache();
    await expect(
      requestJobSteps(new URL(`${run}/job/12`), { fetcher }),
    ).rejects.toMatchObject({ code: "rate-limit" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refreshes running steps after the bounded TTL", async () => {
    const running = page(
      step(1, "Build", { conclusion: "", duration: "" }).replace(
        '<span class="CheckStep-title">',
        '<svg class="octicon-sync"></svg><span class="CheckStep-title">',
      ),
    );
    const fetcher = vi.fn<typeof fetch>(async () => html(running));
    const now = Date.now();
    await requestJobSteps(jobUrl, { fetcher, now });
    await requestJobSteps(jobUrl, { fetcher, now: now + 1000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await requestJobSteps(jobUrl, {
      fetcher,
      now: now + RUNNING_STEPS_TTL + 1000,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [html("", { status: 404 }), "access"],
    [html("", { status: 500 }), "http"],
    [html("<html><body>No steps</body></html>"), "no-steps"],
  ])("raises explicit errors without caching them", async (response, code) => {
    const fetcher = vi.fn<typeof fetch>(async () => response.clone());
    const error = await requestJobSteps(jobUrl, { fetcher }).catch((e) => e);
    expect(error).toBeInstanceOf(JobStepsError);
    expect(error.code).toBe(code);
    await requestJobSteps(jobUrl, { fetcher }).catch(() => undefined);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats a redirect away from the job as an access error", async () => {
    const response = html(page(step(1, "Login form")));
    Object.defineProperty(response, "url", {
      value: "https://github.com/login?return_to=x",
    });
    await expect(
      requestJobSteps(jobUrl, { fetcher: async () => response }),
    ).rejects.toMatchObject({ code: "access" });
  });

  it("reports network failures", async () => {
    await expect(
      requestJobSteps(jobUrl, {
        fetcher: async () => {
          throw new TypeError("offline");
        },
      }),
    ).rejects.toMatchObject({ code: "network" });
  });
});

const mount = async (element: ReturnType<typeof createElement>) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  return container;
};

describe("expanded step rendering", () => {
  it.each(["list", "timeline"])(
    "hides skipped steps in %s mode without renumbering links",
    async (mode) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        html(
          page(
            `${step(1, "Setup")}${step(2, "Skipped test", { conclusion: "skipped" })}${step(3, "Cleanup")}`,
          ),
        ),
      );
      const container = await mount(
        createElement(JobStepList, {
          id: "steps",
          jobUrl: `${run}/job/11`,
          jobName: "build",
          ...(mode === "timeline"
            ? { timeline: { start: 0, span: 120_000, now: Date.now() } }
            : {}),
        }),
      );
      const links = Array.from(
        container.querySelectorAll<HTMLAnchorElement>("li a"),
      );
      expect(links.map((link) => link.textContent)).toEqual([
        "Setup",
        "Cleanup",
      ]);
      expect(new URL(links[1]?.href ?? run).searchParams.get("ae_step")).toBe(
        "3",
      );
    },
  );

  it("shows loading, error with retry, then clickable steps", async () => {
    let fail = true;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        fail
          ? html("", { status: 500 })
          : html(
              page(`${step(1, "Setup")}${step(2, "Test", { duration: "4s" })}`),
            ),
      );
    const container = await mount(
      createElement(JobStepList, {
        id: "steps",
        jobUrl: `${run}/job/11?ae_view=table`,
        jobName: "build",
      }),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "HTTP 500",
    );
    fail = false;
    const retry = container.querySelector<HTMLButtonElement>(
      '[role="alert"] button',
    );
    await act(async () => retry?.click());
    const links = Array.from(container.querySelectorAll("li a"));
    expect(links.map((link) => link.textContent)).toEqual(["Setup", "Test"]);
    expect(
      new URL(links[1]?.getAttribute("href") ?? "").searchParams.get("ae_step"),
    ).toBe("2");
    expect(container.textContent).toContain("4s");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("toggles waterfall steps without inventing bar positions", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      html(page(step(1, "Setup", { duration: "3s" }))),
    );
    const data = {
      attempt: 1,
      context: { runPath: "/acme/widget/actions/runs/102" },
      jobs: [
        {
          id: 11,
          name: "build",
          status: "completed",
          conclusion: "success",
          createdAt: null,
          startedAt: Date.parse("2026-10-26T10:00:00Z"),
          completedAt: Date.parse("2026-10-26T10:02:00Z"),
          timingIssue: null,
        },
      ],
    } as unknown as JobTiming;
    const container = await mount(
      createElement(WaterfallTimeline, { data, now: Date.now() }),
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      ".ae-job-steps-toggle",
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const group = container.querySelector(
      `#${CSS.escape(toggle?.getAttribute("aria-controls") ?? "")}`,
    );
    expect(group?.querySelector("li a")?.textContent).toBe("Setup");
    expect(group?.textContent).toContain("Timing unavailable");
    expect(group?.querySelector(".ae-job-step-bar")).toBeNull();
    expect(container.querySelectorAll(".ae-waterfall-bar")).toHaveLength(1);
    await act(async () => toggle?.click());
    expect(container.querySelector(".ae-job-steps")).toBeNull();
  });

  it("draws nested bars only from real server step timestamps", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      html(
        serverPage(
          `${serverStep(1, "Build", "success", "2026-10-26T10:00:00Z", "2026-10-26T10:01:00Z")}
           ${serverStep(2, "Later", "", "", "")}`,
        ),
      ),
    );
    const data = {
      attempt: 1,
      context: { runPath: "/acme/widget/actions/runs/102" },
      jobs: [
        {
          id: 11,
          name: "build",
          status: "completed",
          conclusion: "success",
          startedAt: Date.parse("2026-10-26T10:00:00Z"),
          completedAt: Date.parse("2026-10-26T10:02:00Z"),
          timingIssue: null,
        },
      ],
    } as unknown as JobTiming;
    const container = await mount(
      createElement(WaterfallTimeline, { data, now: Date.now() }),
    );
    const rows = container.querySelectorAll(".ae-job-step");
    const bar = rows[0]?.querySelector<HTMLElement>(".ae-job-step-bar");
    expect(bar?.style.left).toBe("0%");
    expect(bar?.style.width).toBe("50%");
    expect(rows[0]?.textContent).toContain("1m 0s");
    expect(rows[1]?.querySelector(".ae-job-step-bar")).toBeNull();
    expect(rows[1]?.textContent).toContain("Timing unavailable");
  });
});
