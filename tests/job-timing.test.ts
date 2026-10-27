import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Waterfall } from "../entrypoints/actions.content/Waterfall";
import { timingState } from "../entrypoints/actions.content/WaterfallTimeline";
import type { Surface } from "../lib/github";
import {
  executionInterval,
  formatTimingDuration,
  JobTimingError,
  loadJobTiming,
  parseJobTime,
  queueInterval,
  readTimingContext,
  timingScale,
  timingTicks,
} from "../lib/job-timing";
import { clearJobTimingCache } from "../lib/job-timing-cache";

const runUrl = "https://github.com/acme/widget/actions/runs/102";
const now = Date.parse("2026-10-26T12:00:00Z");
const context = () => readTimingContext(new URL(runUrl));
const job = (id = 11, overrides: Record<string, unknown> = {}) => ({
  id,
  run_id: 102,
  run_attempt: 2,
  name: `build ${id}`,
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-26T10:00:00Z",
  completed_at: "2026-10-26T10:02:00Z",
  ...overrides,
});
const response = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), { status, headers });
const mockApi = (...data: unknown[]) => {
  const fetcher = vi.fn<typeof fetch>();
  data.forEach((value) => {
    fetcher.mockResolvedValueOnce(
      value instanceof Response ? value : response(value),
    );
  });
  return fetcher;
};
const load = (fetcher: typeof fetch, url = runUrl) =>
  loadJobTiming(readTimingContext(new URL(url)), {
    signal: new AbortController().signal,
    fetcher,
  });

afterEach(() => {
  clearJobTimingCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("timing context and timestamps", () => {
  it.each([
    [0, [0]],
    [1, [0]],
    [12_000, [0, 5_000, 10_000]],
    [240_000, [0, 60_000, 120_000, 180_000, 240_000]],
    [395_000, [0, 120_000, 240_000, 360_000]],
    [900_000, [0, 300_000, 600_000, 900_000]],
    [7_200_000, [0, 3_000_000, 6_000_000]],
  ])("uses round evenly spaced ticks for a %i ms span", (span, expected) => {
    expect(timingTicks(span)).toEqual(expected);
  });
  it("uses only a GitHub run or job route, never an unrelated origin", () => {
    expect(context()).toMatchObject({
      repository: "acme/widget",
      runId: 102,
      runPath: "/acme/widget/actions/runs/102",
      attempt: null,
      jobId: null,
    });
    expect(
      readTimingContext(new URL(`${runUrl}/job/44?attempt=1`)),
    ).toMatchObject({ attempt: 1, jobId: 44 });
    expect(readTimingContext(new URL(`${runUrl}/attempts/1`))).toMatchObject({
      attempt: 1,
      jobId: null,
      runPath: "/acme/widget/actions/runs/102",
    });
    for (const url of [
      "https://example.com/acme/widget/actions/runs/102",
      `${runUrl}/other`,
      `${runUrl}?attempt=0`,
      `${runUrl}?attempt=wat`,
      `${runUrl}?attempt=`,
      `${runUrl}?attempt=1&attempt=2`,
      `${runUrl}/attempts/1?attempt=2`,
      `${runUrl}999999999999999999`,
    ])
      expect(() => readTimingContext(new URL(url))).toThrow(JobTimingError);
  });

  it("reads only the same-run rendered attempt marker, without fetching a fragment", () => {
    document.body.innerHTML = `
      <relative-time datetime="2026-10-26T10:00:00Z"></relative-time>
      <include-fragment src="/acme/widget/actions/runs/999/navigation_partial?attempt=5"></include-fragment>
      <include-fragment src="/acme/widget/actions/runs/102/navigation_partial?attempt=1"></include-fragment>`;
    expect(readTimingContext(new URL(runUrl), document).attempt).toBe(1);
    expect(
      readTimingContext(new URL(`${runUrl}?attempt=2`), document).attempt,
    ).toBe(2);
    document.body.insertAdjacentHTML(
      "beforeend",
      '<include-fragment src="/acme/widget/actions/runs/102/navigation_partial?attempt=2"></include-fragment>',
    );
    expect(() => readTimingContext(new URL(runUrl), document)).toThrow(
      /conflicting/,
    );
  });

  it("rejects absent, impossible, sentinel, and ambiguous dates", () => {
    for (const value of [
      null,
      undefined,
      "",
      42,
      "not a time",
      "2026-02-30T00:00:00Z",
      "0001-01-01T00:00:00Z",
      "10/26/2026",
    ])
      expect(parseJobTime(value)).toBeNull();
    expect(parseJobTime("2026-10-26T12:00:00Z")).toBe(now);
    expect(parseJobTime("2026-10-26T12:00:00.123Z")).toBe(now + 123);
    expect(parseJobTime("2026-10-26T05:00:00-07:00")).toBe(now);
    expect(parseJobTime("2026-10-26T17:30:00+05:30")).toBe(now);
    expect(parseJobTime("2026-02-30T00:00:00-07:00")).toBeNull();
  });
});

describe("public attempt-scoped REST timing", () => {
  it("resolves latest once and sends no credentials, page payload, or storage", async () => {
    const fetcher = mockApi(
      { id: 102, run_attempt: 2 },
      { total_count: 1, jobs: [job()] },
    );
    const result = await load(fetcher);
    expect(result).toMatchObject({
      attempt: 2,
      attemptSource: "latest at request",
      totalCount: 1,
      pages: 1,
      incomplete: [],
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/acme/widget/actions/runs/102",
      "https://api.github.com/repos/acme/widget/actions/runs/102/attempts/2/jobs?per_page=100&page=1",
    ]);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      mode: "cors",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
    });
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("body");
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("requests the explicit older attempt, never the latest jobs endpoint", async () => {
    const fetcher = mockApi(
      { id: 102, run_attempt: 3 },
      { total_count: 1, jobs: [job(11, { run_attempt: 1 })] },
    );
    expect((await load(fetcher, `${runUrl}?attempt=1`)).attempt).toBe(1);
    expect(fetcher.mock.calls[1]?.[0]).toContain("/attempts/1/jobs?");
  });

  it("resolves a selected job's real attempt, not the latest attempt", async () => {
    const fetcher = mockApi(
      { id: 102, run_attempt: 3 },
      job(44, { run_attempt: 1 }),
      { total_count: 1, jobs: [job(44, { run_attempt: 1 })] },
    );
    expect(await load(fetcher, `${runUrl}/job/44`)).toMatchObject({
      attempt: 1,
      attemptSource: "selected job",
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/acme/widget/actions/jobs/44",
    );
    expect(fetcher.mock.calls[2]?.[0]).toContain("/attempts/1/jobs?");
  });

  it("fails closed for mismatched job/run identities or mixed attempts", async () => {
    const fetcher = mockApi(
      { id: 102, run_attempt: 2 },
      { total_count: 2, jobs: [job(), job(12, { run_attempt: 1 })] },
    );
    await expect(load(fetcher)).rejects.toMatchObject({ code: "attempt" });
    await expect(
      load(mockApi({ id: 103, run_attempt: 2 })),
    ).rejects.toMatchObject({ code: "schema" });
    await expect(
      load(
        mockApi(
          { id: 102, run_attempt: 2 },
          { total_count: 1, jobs: [job(11, { run_id: 103 })] },
        ),
      ),
    ).rejects.toMatchObject({ code: "schema" });
    await expect(
      load(
        mockApi({ id: 102, run_attempt: 2 }, job(44, { run_attempt: 1 })),
        `${runUrl}/job/44?attempt=2`,
      ),
    ).rejects.toMatchObject({ code: "attempt" });
    await expect(
      load(mockApi({ id: 102, run_attempt: 2 }), `${runUrl}?attempt=3`),
    ).rejects.toMatchObject({ code: "attempt" });
  });

  it("paginates only within the pinned attempt, retaining all jobs", async () => {
    const fetcher = mockApi(
      { id: 102, run_attempt: 2 },
      {
        total_count: 101,
        jobs: Array.from({ length: 100 }, (_, id) => job(id + 1)),
      },
      { total_count: 101, jobs: [job(101)] },
    );
    expect(await load(fetcher)).toMatchObject({
      pages: 2,
      totalCount: 101,
      incomplete: [],
    });
    expect(fetcher.mock.calls[2]?.[0]).toContain(
      "/attempts/2/jobs?per_page=100&page=2",
    );
  });

  it("caps at 1,000 jobs, with truthful incomplete coverage", async () => {
    const fetcher = mockApi(
      { id: 102, run_attempt: 2 },
      ...Array.from({ length: 10 }, (_, page) => ({
        total_count: 1001,
        jobs: Array.from({ length: 100 }, (_, index) =>
          job(page * 100 + index + 1),
        ),
      })),
    );
    const result = await load(fetcher);
    expect(result.jobs).toHaveLength(1000);
    expect(result.pages).toBe(10);
    expect(result.incomplete.join(" ")).toContain("Loaded 1000 of 1001");
    expect(fetcher).toHaveBeenCalledTimes(11);
  });

  it("reports early empty pages, duplicates and changing totals as incomplete", async () => {
    const first = Array.from({ length: 100 }, (_, index) => job(index + 1));
    const fetcher = mockApi(
      { id: 102, run_attempt: 2 },
      { total_count: 102, jobs: first },
      { total_count: 103, jobs: [first[0]] },
    );
    const result = await load(fetcher);
    expect(result.jobs).toHaveLength(100);
    expect(result.incomplete.join(" ")).toMatch(
      /changed.*Duplicate.*100 of 103/,
    );
    const empty = await load(
      mockApi({ id: 102, run_attempt: 2 }, { total_count: 12, jobs: [] }),
    );
    expect(empty.incomplete.join(" ")).toContain("0 of 12");
    expect(
      (
        await load(
          mockApi({ id: 102, run_attempt: 2 }, { total_count: 0, jobs: [] }),
        )
      ).incomplete,
    ).toEqual([]);
  });

  it("trusts an attempt-specific endpoint when optional job run_attempt is absent", async () => {
    const value = job();
    const { run_attempt: _attempt, ...withoutAttempt } = value;
    expect(
      (
        await load(
          mockApi(
            { id: 102, run_attempt: 2 },
            { total_count: 1, jobs: [withoutAttempt] },
          ),
        )
      ).jobs,
    ).toHaveLength(1);
  });

  it.each([
    [403, {}, "access"],
    [401, {}, "access"],
    [404, {}, "unavailable"],
    [429, { "retry-after": "60" }, "rate-limit"],
    [
      403,
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793070000" },
      "rate-limit",
    ],
    [500, {}, "http"],
  ])(
    "exposes HTTP %i errors, never fallback success",
    async (status, headers, code) => {
      await expect(
        load(mockApi(response({}, status, headers))),
      ).rejects.toMatchObject({
        code,
        message: expect.stringContaining(`HTTP ${status}`),
      });
    },
  );

  it("does not turn a later page error into a successful partial result", async () => {
    const fetcher = mockApi(
      { id: 102, run_attempt: 2 },
      {
        total_count: 101,
        jobs: Array.from({ length: 100 }, (_, index) => job(index + 1)),
      },
      response({}, 429),
    );
    await expect(load(fetcher)).rejects.toMatchObject({ code: "rate-limit" });
  });

  it.each([
    { total_count: -1, jobs: [] },
    { total_count: 1, jobs: [null] },
    { total_count: 1, jobs: [job(11, { status: "invented" })] },
    { total_count: "1", jobs: [] },
    { total_count: 1, jobs: "not an array" },
  ])("rejects malformed schemas", async (data) => {
    await expect(
      load(mockApi({ id: 102, run_attempt: 2 }, data)),
    ).rejects.toMatchObject({ code: "schema" });
  });

  it("exposes network/JSON failures and aborts in-flight requests", async () => {
    const failed = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(load(failed)).rejects.toMatchObject({
      code: "network",
      message: expect.stringContaining("No DOM timing fallback"),
    });
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const promise = loadJobTiming(context(), {
      signal: controller.signal,
      fetcher,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const unused = vi.fn<typeof fetch>();
    await expect(
      loadJobTiming(context(), {
        signal: alreadyAborted.signal,
        fetcher: unused,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(unused).not.toHaveBeenCalled();
  });

  it("bounds the request lifetime with a visible timeout error", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const promise = load(fetcher);
    const assertion = expect(promise).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});

describe("honest execution intervals and bounded scale", () => {
  it("does not invent queue/setup times or completed times", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const result = await load(
      mockApi(
        { id: 102, run_attempt: 2 },
        {
          total_count: 7,
          jobs: [
            job(1),
            job(2, {
              status: "in_progress",
              conclusion: null,
              completed_at: null,
            }),
            job(3, { started_at: null }),
            job(4, { completed_at: null }),
            job(5, { status: "queued", started_at: null, completed_at: null }),
            job(6, { completed_at: "2026-10-26T09:00:00Z" }),
            job(7, { started_at: "2026-10-27T00:00:00Z" }),
          ],
        },
      ),
    );
    const completed = result.jobs.find(({ id }) => id === 1);
    const running = result.jobs.find(({ id }) => id === 2);
    expect(completed && executionInterval(completed, now)).toEqual({
      start: now - 7_200_000,
      end: now - 7_080_000,
      ongoing: false,
    });
    expect(running && executionInterval(running, now)).toEqual({
      start: now - 7_200_000,
      end: now,
      ongoing: true,
    });
    result.jobs
      .filter(({ id }) => id > 2)
      .forEach((value) => expect(executionInterval(value, now)).toBeNull());
    expect(timingScale(result.jobs, now)).toEqual({
      start: now - 7_200_000,
      end: now,
      span: 7_200_000,
    });
    expect(timingScale([], now)).toBeNull();
  });

  it("derives queue time from created_at to started_at and widens the scale", async () => {
    const result = await load(
      mockApi(
        { id: 102, run_attempt: 2 },
        {
          total_count: 4,
          jobs: [
            job(1, { created_at: "2026-10-26T09:59:30Z" }),
            job(2, {
              status: "queued",
              conclusion: null,
              created_at: "2026-10-26T11:58:00Z",
              started_at: null,
              completed_at: null,
            }),
            job(3, { created_at: "2026-10-26T10:00:05Z" }),
            job(4),
          ],
        },
      ),
    );
    const [ran, waiting, impossible, missing] = [1, 2, 3, 4].map((id) =>
      result.jobs.find((candidate) => candidate.id === id),
    );
    expect(ran && queueInterval(ran, now)).toEqual({
      start: now - 7_230_000,
      end: now - 7_200_000,
      ongoing: false,
    });
    expect(waiting && queueInterval(waiting, now)).toEqual({
      start: now - 120_000,
      end: now,
      ongoing: true,
    });
    expect(impossible?.createdAt).toBeNull();
    expect(missing && queueInterval(missing, now)).toBeNull();
    expect(timingScale(result.jobs, now)?.start).toBe(now - 7_230_000);
  });

  it("keeps zero-duration jobs real and formats long durations without wide scales", async () => {
    const result = await load(
      mockApi(
        { id: 102, run_attempt: 2 },
        {
          total_count: 1,
          jobs: [job(11, { completed_at: "2026-10-26T10:00:00Z" })],
        },
      ),
    );
    expect(timingScale(result.jobs, now)?.span).toBe(1);
    expect(formatTimingDuration(0)).toBe("0s");
    expect(formatTimingDuration(120_000)).toBe("2m 0s");
    expect(formatTimingDuration(90_061_000)).toBe("25h 1m 1s");
  });
});

describe("opt-in Waterfall UI", () => {
  it("uses explicit job outcomes for semantic colors and state counts", () => {
    const base = {
      id: 1,
      name: "test",
      status: "completed",
      conclusion: "success",
      createdAt: null,
      startedAt: null,
      completedAt: null,
      timingIssue: null,
    };
    expect(timingState(base)).toBe("passed");
    for (const conclusion of ["failure", "timed_out", "startup_failure"])
      expect(timingState({ ...base, conclusion })).toBe("failed");
    expect(
      timingState({ ...base, status: "in_progress", conclusion: null }),
    ).toBe("in_progress");
    expect(timingState({ ...base, conclusion: null })).toBe("unknown");
  });
  it("loads automatically, caches per attempt, and reports retryable errors", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("location", new URL(`${runUrl}?ae_view=waterfall`));
    const fetcher = mockApi(
      response({}, 404),
      { id: 102, run_attempt: 2 },
      { total_count: 1, jobs: [job()] },
      new Response(
        '<section aria-label="Check run summary"><div class="js-check-steps"><check-step data-number="1" data-name="Build" data-conclusion="success" data-started-at="2026-10-26T10:00:00Z" data-completed-at="2026-10-26T10:02:00Z"></check-step></div></section>',
        { headers: { "content-type": "text/html" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const surface: Surface = {
      kind: "jobs",
      repository: "acme/widget",
      anchor: container,
      nativeList: null,
      items: [],
      targets: [],
    };
    await act(async () => root.render(createElement(Waterfall, { surface })));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "HTTP 404",
    );
    expect(container.querySelector("button")).toBeNull();
    await act(async () => root.unmount());
    clearJobTimingCache();
    const retry = createRoot(container);
    await act(async () => retry.render(createElement(Waterfall, { surface })));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(
      container.querySelector(
        "h2, button:not(.ae-job-steps-toggle), select, details",
      ),
    ).toBeNull();
    expect(container.textContent).toContain("2m 0s");
    await act(async () => retry.unmount());
    const again = createRoot(container);
    await act(async () => again.render(createElement(Waterfall, { surface })));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(container.textContent).toContain("2m 0s");
    const link =
      container.querySelector<HTMLAnchorElement>('a[href*="/job/11"]');
    expect(link?.href).toBe(`${runUrl}/job/11?ae_view=waterfall&attempt=2`);
    expect(
      container
        .querySelector(".ae-waterfall-track")
        ?.getAttribute("aria-label"),
    ).toContain("2m 0s execution");
    const bar = container.querySelector<HTMLElement>(".ae-waterfall-bar");
    expect(Number.parseFloat(bar?.style.width ?? "")).toBeLessThanOrEqual(100);
    await act(async () => again.unmount());
  });
});
