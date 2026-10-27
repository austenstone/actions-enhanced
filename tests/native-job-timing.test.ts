import { afterEach, describe, expect, it, vi } from "vitest";
import { type JobTiming, readTimingContext } from "../lib/job-timing";
import {
  clearJobTimingCache,
  isSettled,
  MIN_LIVE_DELAY,
  nextLiveDelay,
  requestJobTiming,
  timingKey,
} from "../lib/job-timing-cache";
import {
  compareWithPage,
  readNativeJobs,
  readNativeStepBounds,
} from "../lib/native-job-timing";

const runUrl = "https://github.com/acme/widget/actions/runs/102";
const runPath = "/acme/widget/actions/runs/102";
const context = (url = runUrl) => readTimingContext(new URL(url));
const apiJob = (id: number, overrides: Record<string, unknown> = {}) => ({
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
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers });
const rate = (remaining: number, reset: number) => ({
  "x-ratelimit-remaining": String(remaining),
  "x-ratelimit-reset": String(reset),
});
const runningApi = () =>
  vi.fn<typeof fetch>().mockImplementation(async (input) =>
    String(input).endsWith("/runs/102")
      ? json({ id: 102, run_attempt: 2 }, 200, rate(50, 2_000_000_000))
      : json(
          {
            total_count: 1,
            jobs: [
              apiJob(11, {
                status: "in_progress",
                completed_at: null,
                conclusion: null,
              }),
            ],
          },
          200,
          rate(49, 2_000_000_000),
        ),
  );

afterEach(() => {
  clearJobTimingCache();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("native page timing data", () => {
  it("reads job identity and status from the rendered page, never timestamps", () => {
    document.body.innerHTML = `
      <streaming-graph-job><a href="${runPath}/job/11">
        <svg class="octicon octicon-check-circle-fill"></svg>
        <span data-target="streaming-graph-job.name">Build</span>
        <div class="text-small color-fg-muted">1m 48s</div></a></streaming-graph-job>
      <nav><a href="${runPath}/job/11"><span data-component="ActionList.Item.Label">Build</span></a>
      <a href="${runPath}/job/12"><svg class="octicon octicon-sync"></svg>Test</a></nav>
      <a href="/acme/widget/actions/runs/999/job/13">Other run</a>
      <div data-actions-enhanced><a href="${runPath}/job/14">Ours</a></div>`;
    expect(readNativeJobs(document, runPath)).toEqual([
      { id: 11, name: "Build", status: "success", duration: "1m 48s" },
      { id: 12, name: "Test", status: "in_progress", duration: "" },
    ]);
  });

  it("bounds only the selected job with rendered step timestamps", () => {
    document.body.innerHTML = `
      <check-step data-started-at="2026-10-26T10:00:05Z" data-completed-at="2026-10-26T10:00:06Z"></check-step>
      <check-step data-started-at="2026-10-26T10:00:06Z" data-completed-at="2026-10-26T10:01:50Z"></check-step>`;
    expect(readNativeStepBounds(document, null)).toBeNull();
    expect(readNativeStepBounds(document, 11)).toEqual({
      jobId: 11,
      steps: 2,
      firstStartedAt: Date.parse("2026-10-26T10:00:05Z"),
      lastCompletedAt: Date.parse("2026-10-26T10:01:50Z"),
    });
    document.body.innerHTML = `<check-step data-started-at="2026-10-26T10:00:05Z"></check-step>`;
    expect(readNativeStepBounds(document, 11)?.lastCompletedAt).toBeNull();
  });

  it("flags page/API disagreement instead of merging or inventing times", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 102, run_attempt: 2 }))
      .mockResolvedValueOnce(
        json({
          total_count: 1,
          jobs: [
            apiJob(11, {
              status: "in_progress",
              conclusion: null,
              completed_at: null,
            }),
          ],
        }),
      );
    const timing = await requestJobTiming(context(), { fetcher });
    const result = compareWithPage(
      timing,
      [
        { id: 11, name: "build 11", status: "success", duration: "2m" },
        { id: 12, name: "new", status: "queued", duration: "" },
      ],
      {
        jobId: 11,
        steps: 1,
        firstStartedAt: Date.parse("2026-10-26T09:59:00Z"),
        lastCompletedAt: null,
      },
    );
    expect(result.pageNewer).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/1 job missing/);
    expect(result.warnings.join(" ")).toMatch(/newer status/);
    expect(result.warnings.join(" ")).toMatch(/step times fall outside/);
  });
});

describe("cached attempt-scoped requests", () => {
  const mockStorage = () => {
    let data: Record<string, unknown> = {};
    const storage = {
      get: vi.fn(async () => structuredClone(data)),
      set: vi.fn(async (value: Record<string, unknown>) => {
        data = structuredClone(value);
      }),
    };
    vi.stubGlobal("chrome", { storage: { local: storage } });
    return storage;
  };

  it("reuses completed snapshots after reload and across job routes without API calls", async () => {
    const storage = mockStorage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 102, run_attempt: 2 }))
      .mockResolvedValueOnce(
        json({ total_count: 2, jobs: [apiJob(11), apiJob(12)] }),
      );
    const value = await requestJobTiming(context(), { fetcher });
    expect(storage.set).toHaveBeenCalledOnce();
    clearJobTimingCache();
    const cached = await requestJobTiming(context(`${runUrl}/attempts/2`), {
      fetcher,
    });
    expect(cached.jobs).toEqual(value.jobs);
    await requestJobTiming(context(`${runUrl}/job/12`), { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("persists a global rate-limit cooldown across reloads and different runs", async () => {
    mockStorage();
    const reset = Math.floor(Date.now() / 1000) + 600;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({}, 403, rate(0, reset)));
    await expect(
      requestJobTiming(context(), { fetcher }),
    ).rejects.toMatchObject({ code: "rate-limit" });
    clearJobTimingCache();
    await expect(
      requestJobTiming(context(runUrl.replace("102", "103")), {
        fetcher,
        force: true,
      }),
    ).rejects.toMatchObject({ code: "rate-limit" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("dedupes in-flight requests and scopes the cache by repo/run/attempt", async () => {
    const fetcher = runningApi();
    const [a, b] = await Promise.all([
      requestJobTiming(context(), { fetcher }),
      requestJobTiming(context(), { fetcher }),
    ]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(timingKey(context())).toBe("acme/widget/102/latest");
    expect(timingKey(context(`${runUrl}/attempts/1`))).toBe(
      "acme/widget/102/1",
    );
    expect(timingKey(context(`${runUrl}/job/11`))).toBe(
      "acme/widget/102/job-11",
    );
    await requestJobTiming(context(), { fetcher, now: a.fetchedAt + 1000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps a settled attempt static automatically but refetches on explicit refresh", async () => {
    const settled = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: 102, run_attempt: 1 }))
      .mockResolvedValueOnce(
        json({ total_count: 1, jobs: [apiJob(11, { run_attempt: 1 })] }),
      )
      .mockResolvedValueOnce(json({ id: 102, run_attempt: 2 }))
      .mockResolvedValueOnce(
        json({
          total_count: 1,
          jobs: [
            apiJob(21, {
              status: "in_progress",
              conclusion: null,
              completed_at: null,
            }),
          ],
        }),
      );
    const value = await requestJobTiming(context(), { fetcher: settled });
    expect(isSettled(value)).toBe(true);
    await requestJobTiming(context(), {
      fetcher: settled,
      now: value.fetchedAt + 3_600_000,
    });
    expect(settled).toHaveBeenCalledTimes(2);
    const rerun = await requestJobTiming(context(), {
      fetcher: settled,
      force: true,
    });
    expect(settled).toHaveBeenCalledTimes(4);
    expect(rerun.attempt).toBe(2);
    expect(rerun.jobs.map(({ id }) => id)).toEqual([21]);
  });

  it("reuses a pinned attempt on refresh", async () => {
    const running = runningApi();
    const pinned = context(`${runUrl}/attempts/2`);
    clearJobTimingCache();
    await requestJobTiming(pinned, { fetcher: running });
    await requestJobTiming(pinned, { fetcher: running, force: true });
    expect(running.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.github.com/repos/acme/widget/actions/runs/102",
      "https://api.github.com/repos/acme/widget/actions/runs/102/attempts/2/jobs?per_page=100&page=1",
      "https://api.github.com/repos/acme/widget/actions/runs/102/attempts/2/jobs?per_page=100&page=1",
    ]);
  });

  it("holds rate-limit errors until reset, even for explicit retries", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({}, 403, rate(0, reset)));
    await expect(
      requestJobTiming(context(), { fetcher }),
    ).rejects.toMatchObject({
      code: "rate-limit",
      retryAt: reset * 1000,
    });
    await expect(
      requestJobTiming(context(), { fetcher, force: true }),
    ).rejects.toMatchObject({ code: "rate-limit" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry permanent errors automatically, but allows explicit retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, 404));
    await expect(
      requestJobTiming(context(), { fetcher }),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      requestJobTiming(context(), { fetcher }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      requestJobTiming(context(), { fetcher, force: true }),
    ).rejects.toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("live polling budget", () => {
  const timing = (overrides: Partial<JobTiming> = {}): JobTiming => ({
    context: context(),
    attempt: 2,
    attemptSource: "latest at request",
    jobs: [
      {
        id: 11,
        name: "build",
        status: "in_progress",
        conclusion: null,
        createdAt: null,
        startedAt: 0,
        completedAt: null,
        timingIssue: null,
      },
    ],
    totalCount: 1,
    pages: 1,
    fetchedAt: 0,
    incomplete: [],
    sourceUrl: "",
    requests: 1,
    rateLimit: { remaining: 50, resetAt: 3_600_000 },
    ...overrides,
  });
  it("stops for settled runs and an exhausted budget", () => {
    expect(
      nextLiveDelay(
        timing({
          jobs: [{ ...timing().jobs[0]!, status: "completed", completedAt: 1 }],
        }),
        0,
      ),
    ).toBeNull();
    expect(
      nextLiveDelay(timing({ rateLimit: { remaining: 10, resetAt: 1 } }), 0),
    ).toBeNull();
  });
  it("spreads refreshes over the remaining hourly budget, never under a minute", () => {
    expect(nextLiveDelay(timing(), 0)).toBe(90_000);
    expect(
      nextLiveDelay(
        timing({ rateLimit: { remaining: 5000, resetAt: 3_600_000 } }),
        0,
      ),
    ).toBe(MIN_LIVE_DELAY);
    expect(nextLiveDelay(timing({ pages: 4 }), 0)).toBe(360_000);
  });
});
