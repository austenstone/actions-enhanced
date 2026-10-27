import { runPathFor } from "./job-navigation";

export type TimingContext = {
  repository: string;
  runId: number;
  runPath: string;
  attempt: number | null;
  jobId: number | null;
};

export type TimedJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  timingIssue: string | null;
};

export type JobTiming = {
  context: TimingContext;
  attempt: number;
  attemptSource: "page" | "selected job" | "latest at request";
  jobs: TimedJob[];
  totalCount: number;
  pages: number;
  fetchedAt: number;
  incomplete: string[];
  sourceUrl: string;
  requests: number;
  rateLimit: RateLimit;
};

export type RateLimit = { remaining: number | null; resetAt: number | null };

export class JobTimingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAt: number | null = null,
  ) {
    super(message);
    this.name = "JobTimingError";
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const parseId = (value: string) => {
  const parsed = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !positiveInteger(parsed))
    throw new JobTimingError(
      "context",
      "The run, job, or attempt ID is invalid.",
    );
  return parsed;
};

export const readTimingContext = (url: URL, doc?: Document): TimingContext => {
  const runPath = runPathFor(url.pathname);
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/(\d+)(?:\/attempts\/(\d+)|\/job\/(\d+))?\/?$/,
  );
  if (url.origin !== "https://github.com" || !match || !runPath)
    throw new JobTimingError(
      "unsupported",
      "Job timing supports GitHub.com workflow run pages only.",
    );
  const explicitAttempts = url.searchParams.getAll("attempt");
  if (explicitAttempts.length > 1)
    throw new JobTimingError(
      "context",
      "The selected run attempt is ambiguous.",
    );
  const pathAttempt = match[4] ? parseId(match[4]) : null;
  const queryAttempt = explicitAttempts[0]
    ? parseId(explicitAttempts[0])
    : null;
  if (
    pathAttempt !== null &&
    queryAttempt !== null &&
    pathAttempt !== queryAttempt
  )
    throw new JobTimingError(
      "context",
      "The URL refers to conflicting run attempts.",
    );
  let attempt = pathAttempt ?? queryAttempt;
  if (explicitAttempts.length && !explicitAttempts[0]) parseId("");
  // Read only the attempt marker already rendered by GitHub; never request fragments.
  if (attempt === null && doc) {
    const attempts = new Set<number>();
    doc.querySelectorAll("include-fragment[src]").forEach((element) => {
      const source = new URL(element.getAttribute("src") ?? "", url);
      if (
        source.origin === url.origin &&
        source.pathname === `${runPath}/navigation_partial` &&
        source.searchParams.has("attempt")
      )
        attempts.add(parseId(source.searchParams.get("attempt") ?? ""));
    });
    if (attempts.size > 1)
      throw new JobTimingError(
        "context",
        "The page shows conflicting run attempts.",
      );
    attempt = attempts.values().next().value ?? null;
  }
  return {
    repository: `${match[1]}/${match[2]}`,
    runPath,
    runId: parseId(match[3] ?? ""),
    jobId: match[5] ? parseId(match[5]) : null,
    attempt,
  };
};

export const parseJobTime = (value: unknown): number | null => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return null;
  const time = Date.parse(value);
  const [, sign, hours = "0", minutes = "0"] =
    value.match(/([+-])(\d{2}):(\d{2})$/) ?? [];
  const offsetMs =
    (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
  return Number.isFinite(time) &&
    time >= 0 &&
    new Date(time + offsetMs).toISOString().slice(0, 19) === value.slice(0, 19)
    ? time
    : null;
};

const statuses = new Set([
  "queued",
  "in_progress",
  "completed",
  "waiting",
  "requested",
  "pending",
]);
const parseJob = (
  value: unknown,
  runId: number,
  attempt: number,
  now: number,
): TimedJob => {
  if (
    !record(value) ||
    !positiveInteger(value.id) ||
    value.run_id !== runId ||
    typeof value.name !== "string" ||
    typeof value.status !== "string" ||
    !statuses.has(value.status) ||
    !(value.conclusion === null || typeof value.conclusion === "string")
  )
    throw new JobTimingError(
      "schema",
      "GitHub returned an invalid job response.",
    );
  if (value.run_attempt !== undefined && value.run_attempt !== attempt)
    throw new JobTimingError(
      "attempt",
      "GitHub returned jobs from a different attempt. No mixed-attempt timing is shown.",
    );
  const startedAt = parseJobTime(value.started_at);
  const completedAt = parseJobTime(value.completed_at);
  const created = parseJobTime(value.created_at);
  const createdAt =
    created !== null &&
    created <= now &&
    (startedAt === null || created <= startedAt)
      ? created
      : null;
  const timingIssue = !["in_progress", "completed"].includes(value.status)
    ? "Not executing; no execution interval."
    : startedAt === null
      ? "Start time missing or invalid."
      : startedAt > now
        ? "Start time is in the future; check your clock."
        : value.status === "completed" && completedAt === null
          ? "Completion time missing or invalid."
          : completedAt !== null && completedAt < startedAt
            ? "Completion time precedes start time."
            : completedAt !== null && completedAt > now
              ? "Completion time is in the future; check your clock."
              : value.status === "in_progress" && value.completed_at !== null
                ? "Running job has an unexpected completion time."
                : null;
  return {
    id: value.id,
    name: value.name,
    status: value.status,
    conclusion: value.conclusion,
    createdAt,
    startedAt,
    completedAt,
    timingIssue,
  };
};

const headerNumber = (response: Response, name: string) => {
  const value = response.headers.get(name);
  return value && /^\d+$/.test(value) ? Number(value) : null;
};

export const readRateLimit = (response: Response): RateLimit => {
  const reset = headerNumber(response, "x-ratelimit-reset");
  return {
    remaining: headerNumber(response, "x-ratelimit-remaining"),
    resetAt: reset === null ? null : reset * 1000,
  };
};

const apiError = (response: Response) => {
  const retry = response.headers.get("retry-after");
  const reset = response.headers.get("x-ratelimit-reset");
  const retrySeconds = headerNumber(response, "retry-after");
  const resetAt = readRateLimit(response).resetAt;
  const limited =
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0");
  if (limited)
    return new JobTimingError(
      "rate-limit",
      `GitHub's unauthenticated API rate limit was reached (HTTP ${response.status}). ${
        retry && /^\d+$/.test(retry)
          ? `Retry after ${retry} seconds.`
          : reset &&
              /^\d+$/.test(reset) &&
              Number.isFinite(Number(reset) * 1000)
            ? `Rate limit reset: ${new Date(Number(reset) * 1000).toLocaleString()}.`
            : "Wait before retrying."
      }`,
      retrySeconds !== null
        ? Date.now() + retrySeconds * 1000
        : (resetAt ?? Date.now() + 60_000),
    );
  if (response.status === 404)
    return new JobTimingError(
      "unavailable",
      "GitHub API returned HTTP 404. This run or attempt is unavailable to unauthenticated requests. Private repositories require future explicit authentication support.",
    );
  if (response.status === 401 || response.status === 403)
    return new JobTimingError(
      "access",
      `GitHub API denied access (HTTP ${response.status}). Only unauthenticated public repository timing is supported. No session credentials are used.`,
    );
  return new JobTimingError(
    "http",
    `GitHub API request failed (HTTP ${response.status}). Retry explicitly to load timing.`,
  );
};

export const loadJobTiming = async (
  context: TimingContext,
  options: {
    signal: AbortSignal;
    fetcher?: typeof fetch;
    resolvedAttempt?: number;
  },
): Promise<JobTiming> => {
  const { signal, fetcher = fetch, resolvedAttempt } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);
  const base = `https://api.github.com/repos/${context.repository}/actions`;
  let requests = 0;
  let rateLimit: RateLimit = { remaining: null, resetAt: null };
  const request = async (url: string): Promise<unknown> => {
    controller.signal.throwIfAborted();
    requests++;
    const response = await fetcher(url, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      mode: "cors",
      headers: { Accept: "application/vnd.github+json" },
    });
    rateLimit = readRateLimit(response);
    if (!response.ok) throw apiError(response);
    return response.json();
  };
  const resolveAttempt = async (): Promise<
    [number, JobTiming["attemptSource"]]
  > => {
    const run = await request(`${base}/runs/${context.runId}`);
    if (
      !record(run) ||
      run.id !== context.runId ||
      !positiveInteger(run.run_attempt)
    )
      throw new JobTimingError(
        "schema",
        "GitHub returned invalid run details.",
      );
    let attempt = context.attempt ?? run.run_attempt;
    let attemptSource: JobTiming["attemptSource"] =
      context.attempt === null ? "latest at request" : "page";
    if (context.jobId !== null) {
      const selected = await request(`${base}/jobs/${context.jobId}`);
      if (
        !record(selected) ||
        selected.id !== context.jobId ||
        selected.run_id !== context.runId ||
        !positiveInteger(selected.run_attempt)
      )
        throw new JobTimingError(
          "schema",
          "GitHub could not identify the selected job's attempt.",
        );
      if (context.attempt !== null && context.attempt !== selected.run_attempt)
        throw new JobTimingError(
          "attempt",
          "The selected job and page refer to different run attempts.",
        );
      attempt = selected.run_attempt;
      attemptSource = context.attempt === null ? "selected job" : "page";
    }
    if (attempt > run.run_attempt)
      throw new JobTimingError(
        "attempt",
        "The selected attempt is newer than GitHub's run details. Retry after the run updates.",
      );
    return [attempt, attemptSource];
  };
  try {
    const [attempt, attemptSource] =
      resolvedAttempt === undefined
        ? await resolveAttempt()
        : [
            resolvedAttempt,
            context.attempt !== null
              ? ("page" as const)
              : context.jobId !== null
                ? ("selected job" as const)
                : ("latest at request" as const),
          ];
    const sourceUrl = `${base}/runs/${context.runId}/attempts/${attempt}/jobs`;
    const jobs = new Map<number, TimedJob>();
    const incomplete = new Set<string>();
    let totalCount = 0;
    let pages = 0;
    const fetchedAt = Date.now();
    for (let page = 1; page <= 10; page++) {
      const data = await request(`${sourceUrl}?per_page=100&page=${page}`);
      if (
        !record(data) ||
        typeof data.total_count !== "number" ||
        !Number.isSafeInteger(data.total_count) ||
        data.total_count < 0 ||
        !Array.isArray(data.jobs) ||
        data.jobs.length > 100
      )
        throw new JobTimingError(
          "schema",
          "GitHub returned an invalid jobs page.",
        );
      if (page > 1 && data.total_count !== totalCount)
        incomplete.add(
          "The job count changed while loading; refresh for a new snapshot.",
        );
      totalCount = data.total_count;
      pages = page;
      data.jobs.forEach((value: unknown) => {
        const job = parseJob(value, context.runId, attempt, fetchedAt);
        if (jobs.has(job.id))
          incomplete.add(
            "Duplicate jobs appeared across pages; coverage may have changed.",
          );
        jobs.set(job.id, job);
      });
      if (page * 100 >= totalCount || data.jobs.length < 100) break;
    }
    if (jobs.size !== totalCount)
      incomplete.add(
        `Loaded ${jobs.size} of ${totalCount} reported jobs. Pagination is capped at 10 pages / 1,000 jobs.`,
      );
    return {
      context,
      attempt,
      attemptSource,
      jobs: [...jobs.values()].sort(
        (a, b) =>
          (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || a.id - b.id,
      ),
      totalCount,
      pages,
      fetchedAt,
      incomplete: [...incomplete],
      sourceUrl,
      requests,
      rateLimit,
    };
  } catch (error) {
    if (signal.aborted)
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (timedOut)
      throw new JobTimingError(
        "timeout",
        "GitHub API timed out after 30 seconds. Retry to request a new snapshot.",
      );
    if (error instanceof JobTimingError) throw error;
    throw new JobTimingError(
      "network",
      `Unable to load public GitHub API timing: ${error instanceof Error ? error.message : "network or response error"}. No DOM timing fallback was used.`,
    );
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
};

export const executionInterval = (job: TimedJob, now: number) => {
  if (job.timingIssue || job.startedAt === null) return null;
  const end = job.completedAt ?? (job.status === "in_progress" ? now : null);
  return end !== null && end >= job.startedAt
    ? { start: job.startedAt, end, ongoing: job.status === "in_progress" }
    : null;
};

// Created → started: time waiting for a runner (and any concurrency hold).
export const queueInterval = (job: TimedJob, now: number) => {
  if (job.createdAt === null) return null;
  const end = job.startedAt ?? (job.status === "queued" ? now : null);
  return end !== null && end >= job.createdAt
    ? { start: job.createdAt, end, ongoing: job.startedAt === null }
    : null;
};

export const timingScale = (jobs: TimedJob[], now: number) => {
  const intervals = jobs.flatMap((job) =>
    [executionInterval(job, now), queueInterval(job, now)].flatMap(
      (interval) => (interval ? [interval] : []),
    ),
  );
  if (!intervals.length) return null;
  const start = Math.min(...intervals.map((interval) => interval.start));
  const end = Math.max(...intervals.map((interval) => interval.end));
  return { start, end, span: Math.max(1, end - start) };
};

export const timingTicks = (span: number) => {
  const target = Math.max(1, span / 4 / 1000);
  const unit = target < 60 ? 1 : target < 3600 ? 60 : 3600;
  const magnitude = 10 ** Math.floor(Math.log10(target / unit));
  const step =
    ([1, 2, 5, 10].find((value) => value * magnitude * unit >= target) ?? 10) *
    magnitude *
    unit *
    1000;
  return Array.from(
    { length: Math.floor(span / step) + 1 },
    (_, index) => index * step,
  );
};

export const formatTimingDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
};
