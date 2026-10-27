import type { browser } from "wxt/browser";
import {
  type JobTiming,
  JobTimingError,
  loadJobTiming,
  type TimingContext,
} from "./job-timing";

type Entry = {
  promise?: Promise<JobTiming>;
  value?: JobTiming;
  error?: JobTimingError;
  retryAt?: number;
};

export const ACTIVE_TTL = 60_000;
export const MIN_LIVE_DELAY = 60_000;
export const RATE_RESERVE = 10;
const MAX_ENTRIES = 20;
const TRANSIENT_RETRY = 30_000;
const cache = new Map<string, Entry>();
const STORAGE_KEY = "actions-enhanced:job-timing:v1";
const RETENTION = 30 * 24 * 60 * 60 * 1000;
const extensionStorage = () =>
  (globalThis as typeof globalThis & { chrome?: typeof browser }).chrome
    ?.storage?.local;
let hydration: Promise<void> | undefined;
let writes = Promise.resolve();
let blocked: JobTimingError | undefined;

const hydrate = () => {
  hydration ??= (async () => {
    const storage = extensionStorage();
    if (!storage) return;
    try {
      const saved = (await storage.get(STORAGE_KEY))[STORAGE_KEY] as
        | {
            values?: JobTiming[];
            blocked?: { message: string; retryAt: number };
          }
        | undefined;
      for (const value of [...(saved?.values ?? [])].sort(
        (a, b) => a.fetchedAt - b.fetchedAt,
      )) {
        if (
          Date.now() - value.fetchedAt < RETENTION &&
          Array.isArray(value.jobs) &&
          Array.isArray(value.incomplete) &&
          value.context &&
          Number.isSafeInteger(value.attempt)
        )
          remember(
            value,
            timingKey(
              value.context.attempt === null &&
                value.context.jobId === null &&
                Date.now() - value.fetchedAt >= ACTIVE_TTL
                ? { ...value.context, attempt: value.attempt }
                : value.context,
            ),
          );
      }
      if (saved?.blocked && saved.blocked.retryAt > Date.now())
        blocked = new JobTimingError(
          "rate-limit",
          saved.blocked.message,
          saved.blocked.retryAt,
        );
    } catch (error) {
      console.warn("Actions Enhanced could not read its timing cache.", error);
    }
  })();
  return hydration;
};

const remember = (value: JobTiming, key: string) => {
  cache.set(key, { value });
  cache.set(timingKey({ ...value.context, attempt: value.attempt }), { value });
  while (cache.size > MAX_ENTRIES * 2) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const persist = () => {
  const values = [
    ...new Set(
      [...cache.values()].flatMap((entry) =>
        entry.value ? [entry.value] : [],
      ),
    ),
  ]
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .slice(0, MAX_ENTRIES);
  const saved = {
    values,
    blocked: blocked?.retryAt
      ? { message: blocked.message, retryAt: blocked.retryAt }
      : undefined,
  };
  writes = writes.then(async () => {
    try {
      await extensionStorage()?.set({ [STORAGE_KEY]: saved });
    } catch (error) {
      console.warn("Actions Enhanced could not save its timing cache.", error);
    }
  });
  return writes;
};

export const timingKey = ({
  repository,
  runId,
  attempt,
  jobId,
}: TimingContext) =>
  `${repository.toLowerCase()}/${runId}/${
    attempt ?? (jobId === null ? "latest" : `job-${jobId}`)
  }`;

export const isSettled = (timing: JobTiming) =>
  timing.incomplete.length === 0 &&
  timing.jobs.length === timing.totalCount &&
  timing.jobs.every((job) => job.status === "completed");

const retryAtFor = (error: JobTimingError, now: number) =>
  error.code === "rate-limit"
    ? (error.retryAt ?? now + 60_000)
    : ["network", "timeout", "http"].includes(error.code)
      ? now + TRANSIENT_RETRY
      : Number.POSITIVE_INFINITY;

export const peekJobTiming = (context: TimingContext) =>
  cache.get(timingKey(context))?.value ?? null;

export const clearJobTimingCache = () => {
  cache.clear();
  hydration = undefined;
  blocked = undefined;
};

// Shared across mounts and route changes: one in-flight request per run
// attempt, settled runs are only refetched on explicit request (reruns can
// change a "latest" attempt), and failures are not retried in a loop.
export const requestJobTiming = async (
  context: TimingContext,
  options: { fetcher?: typeof fetch; force?: boolean; now?: number } = {},
): Promise<JobTiming> => {
  await hydrate();
  const { fetcher, force = false, now = Date.now() } = options;
  const key = timingKey(context);
  const entry =
    cache.get(key) ??
    (context.jobId !== null && context.attempt === null
      ? [...cache.values()].find(
          ({ value }) =>
            value?.context.repository.toLowerCase() ===
              context.repository.toLowerCase() &&
            value.context.runId === context.runId &&
            value.jobs.some((job) => job.id === context.jobId),
        )
      : undefined);
  if (entry?.promise) return entry.promise;
  if (!force && entry?.value && isSettled(entry.value))
    return Promise.resolve(entry.value);
  if (
    entry?.error &&
    entry.retryAt !== undefined &&
    now < entry.retryAt &&
    (!force || entry.error.code === "rate-limit")
  )
    return Promise.reject(entry.error);
  if (!force && entry?.value && now - entry.value.fetchedAt < ACTIVE_TTL)
    return Promise.resolve(entry.value);
  if (blocked?.retryAt && now < blocked.retryAt) throw blocked;
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const value = await loadJobTiming(context, {
        signal: controller.signal,
        fetcher,
        resolvedAttempt:
          entry?.value && entry.value.attemptSource !== "latest at request"
            ? entry.value.attempt
            : undefined,
      });
      remember(value, key);
      await persist();
      return value;
    } catch (failure) {
      const error =
        failure instanceof JobTimingError
          ? failure
          : new JobTimingError("network", "Job timing failed.");
      cache.set(key, {
        value: entry?.value,
        error,
        retryAt: retryAtFor(error, Date.now()),
      });
      if (error.code === "rate-limit") {
        blocked = new JobTimingError(
          error.code,
          error.message,
          error.retryAt ?? Date.now() + 60_000,
        );
        await persist();
      }
      throw error;
    }
  })();
  cache.delete(key);
  cache.set(key, { ...entry, promise });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined && oldest !== key) cache.delete(oldest);
  }
  return promise;
};

// Spread live refreshes over the remaining unauthenticated budget so a running
// run never exhausts the hourly limit; returns null when polling must stop.
export const nextLiveDelay = (timing: JobTiming, now = Date.now()) => {
  if (isSettled(timing)) return null;
  const { remaining, resetAt } = timing.rateLimit;
  const cost = Math.max(1, timing.pages);
  if (remaining === null || resetAt === null) return MIN_LIVE_DELAY * 2;
  const budget = Math.floor((remaining - RATE_RESERVE) / cost);
  if (budget <= 0) return null;
  return Math.max(MIN_LIVE_DELAY, Math.ceil((resetAt - now) / budget));
};

export const prefetchJobTiming = (
  context: TimingContext,
  fetcher?: typeof fetch,
) => {
  requestJobTiming(context, { fetcher }).catch(() => undefined);
};
