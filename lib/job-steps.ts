import { readStatus, statusLabels } from "./github";
import { runPathFor } from "./job-navigation";
import { formatTimingDuration, parseJobTime } from "./job-timing";
import { jobHref } from "./run-url";

export type JobStep = {
  number: number;
  name: string;
  status: string;
  duration: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

export type JobStepsErrorCode =
  | "invalid-url"
  | "access"
  | "http"
  | "network"
  | "rate-limit"
  | "no-steps";

export class JobStepsError extends Error {
  readonly code: JobStepsErrorCode;
  readonly httpStatus: number | null;
  constructor(code: JobStepsErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = "JobStepsError";
    this.code = code;
    this.httpStatus = httpStatus ?? null;
  }
}

export const RUNNING_STEPS_TTL = 15_000;
const MAX_ENTRIES = 500;
const STORAGE_PREFIX = "actions-enhanced:job-steps:v1:";
const BLOCKED_KEY = `${STORAGE_PREFIX}blocked`;
const RETENTION = 30 * 24 * 60 * 60 * 1000;
const DURATION = /^(?:\d+(?:\.\d+)?(?:ms|[dhms])\s*)+$/;
const PENDING = new Set(["in_progress", "queued", "unknown"]);

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const positiveInt = (value: string | null | undefined) =>
  value && /^[1-9]\d*$/.test(value) ? Number(value) : null;

const directSummary = (details: Element) =>
  Array.from(details.children).find((child) => child.tagName === "SUMMARY") ??
  null;

const stepRoots = (doc: Document) => {
  const sections = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'section[aria-label="Check run summary"]',
    ),
  ).filter((section) => !section.closest("[data-actions-enhanced]"));
  if (sections.length)
    return sections.filter(
      (section) => !section.hidden && !section.closest("[hidden]"),
    );
  return Array.from(doc.querySelectorAll<HTMLElement>(".js-check-steps"));
};

const stepStatus = (
  host: Element | null,
  summary: Element | null,
  startedAt: number | null,
  completedAt: number | null,
) => {
  const conclusion = host?.getAttribute("data-conclusion") ?? "";
  if (conclusion === "failure" || conclusion === "timed_out") return "failure";
  if (conclusion in statusLabels) return conclusion;
  if (conclusion === "neutral") return "success";
  const native = summary ? readStatus(summary) : "unknown";
  if (native !== "unknown" || conclusion) return native;
  return startedAt === null
    ? "queued"
    : completedAt === null
      ? "in_progress"
      : "unknown";
};

const headerDuration = (summary: Element | null) => {
  if (!summary) return null;
  const value =
    text(summary.querySelector(".text-small.float-right")) ||
    Array.from(summary.querySelectorAll("span, div"))
      .filter(
        (element) =>
          !element.children.length && !element.closest(".CheckStep-title"),
      )
      .map(text)
      .filter((candidate) => DURATION.test(candidate))
      .at(-1);
  return value && DURATION.test(value) ? value : null;
};

const readStep = (
  host: Element | null,
  details: Element | null,
  index: number,
): JobStep | null => {
  const summary = details ? directSummary(details) : null;
  const number =
    positiveInt(host?.getAttribute("data-number")) ??
    positiveInt(details?.getAttribute("data-step-number")) ??
    positiveInt(details?.id.match(/^(?:check-)?step-(\d+)$/)?.[1]) ??
    index + 1;
  const name =
    text(summary?.querySelector(".CheckStep-titleName")) ||
    host?.getAttribute("data-name")?.replace(/\s+/g, " ").trim() ||
    text(summary?.querySelector(".CheckStep-title"));
  if (!name) return null;
  const startedAt = parseJobTime(host?.getAttribute("data-started-at"));
  const ended = parseJobTime(host?.getAttribute("data-completed-at"));
  const completedAt =
    startedAt !== null && ended !== null && ended >= startedAt ? ended : null;
  return {
    number,
    name,
    status: stepStatus(host ?? details, summary, startedAt, completedAt),
    duration:
      headerDuration(summary) ??
      (startedAt !== null && completedAt !== null
        ? formatTimingDuration(completedAt - startedAt)
        : null),
    startedAt,
    completedAt,
  };
};

// Header-only: step name, number, conclusion, rendered duration and the
// check-step start/end attributes GitHub server-renders. Log payloads and log
// URLs are never read or returned.
export const readNativeJobSteps = (doc: Document): JobStep[] => {
  const seen = new Set<Element>();
  const steps = stepRoots(doc).flatMap((root) => {
    const hosts = Array.from(root.querySelectorAll("check-step"));
    const elements: [Element | null, Element | null][] = hosts.length
      ? hosts.map((host) => [
          host,
          host.querySelector("details.js-checks-log-details"),
        ])
      : Array.from(root.querySelectorAll("details.js-checks-log-details")).map(
          (details) => [null, details],
        );
    return elements.flatMap(([host, details], index) => {
      const element = host ?? details;
      if (
        !element ||
        seen.has(element) ||
        element.closest("[data-actions-enhanced]")
      )
        return [];
      seen.add(element);
      const step = readStep(host, details, index);
      return step ? [step] : [];
    });
  });
  const numbers = new Set<number>();
  return steps.filter(({ number }) =>
    numbers.has(number) ? false : (numbers.add(number), true),
  );
};

export const stepsSettled = (steps: JobStep[]) =>
  steps.length > 0 && steps.every(({ status }) => !PENDING.has(status));

type JobTarget = { key: string; fetchUrl: string; jobPath: string };

const attemptFor = (url: URL) =>
  url.pathname.match(/\/attempts\/([1-9]\d*)\/?$/)?.[1] ??
  url.searchParams.get("attempt") ??
  "";

const resolveTarget = (jobUrl: URL, current: URL): JobTarget => {
  const run = runPathFor(current.pathname);
  const match = jobUrl.pathname.match(/^(.+)\/job\/([1-9]\d*)\/?$/);
  if (
    jobUrl.origin !== current.origin ||
    !run ||
    !match ||
    match[1] !== run ||
    runPathFor(jobUrl.pathname) !== run
  )
    throw new JobStepsError(
      "invalid-url",
      "Steps can only be loaded for a job in the current run.",
    );
  const jobPath = `${run}/job/${match[2]}`;
  const attempt = attemptFor(jobUrl);
  return {
    jobPath,
    // GitHub assigns a new job ID on each attempt; view parameters are not identity.
    key: `${jobUrl.origin}${jobPath.toLowerCase()}`,
    fetchUrl: `${jobUrl.origin}${jobPath}${attempt && /^[1-9]\d*$/.test(attempt) ? `?attempt=${attempt}` : ""}`,
  };
};

const selectedJobPathFor = (url: URL) => {
  const run = runPathFor(url.pathname);
  const job =
    url.pathname.match(/\/job\/([1-9]\d*)\/?$/)?.[1] ??
    positiveInt(url.searchParams.get("ae_job"))?.toString();
  return run && job ? `${run}/job/${job}` : "";
};

type Entry = {
  promise?: Promise<JobStep[]>;
  value?: JobStep[];
  fetchedAt?: number;
};
const cache = new Map<string, Entry>();
const extensionStorage = () =>
  (globalThis as typeof globalThis & { chrome?: typeof browser }).chrome
    ?.storage?.local;
let hydration: Promise<void> | undefined;
let blockedUntil = 0;
const validSteps = (value: unknown): value is JobStep[] =>
  Array.isArray(value) &&
  value.every(
    (step) =>
      step &&
      Number.isSafeInteger(step.number) &&
      typeof step.name === "string" &&
      typeof step.status === "string" &&
      (step.duration === null || typeof step.duration === "string") &&
      (step.startedAt === null || Number.isFinite(step.startedAt)) &&
      (step.completedAt === null || Number.isFinite(step.completedAt)),
  );

const hydrate = () => {
  hydration ??= (async () => {
    const storage = extensionStorage();
    if (!storage) return;
    try {
      const saved = await storage.get(null);
      blockedUntil =
        typeof saved[BLOCKED_KEY] === "number" ? saved[BLOCKED_KEY] : 0;
      const entries = Object.entries(saved)
        .filter(
          ([key]) => key.startsWith(STORAGE_PREFIX) && key !== BLOCKED_KEY,
        )
        .flatMap(([key, entry]) =>
          entry &&
          typeof entry === "object" &&
          "fetchedAt" in entry &&
          "value" in entry &&
          typeof entry.fetchedAt === "number" &&
          Date.now() - entry.fetchedAt < RETENTION &&
          validSteps(entry.value)
            ? [
                {
                  key,
                  value: entry.value,
                  fetchedAt: entry.fetchedAt,
                },
              ]
            : [],
        )
        .sort((a, b) => b.fetchedAt - a.fetchedAt)
        .slice(0, MAX_ENTRIES);
      for (const entry of entries)
        cache.set(entry.key.slice(STORAGE_PREFIX.length), {
          value: entry.value,
          fetchedAt: entry.fetchedAt,
        });
      const keep = new Set(entries.map(({ key }) => key));
      const expired = Object.keys(saved).filter(
        (key) =>
          key.startsWith(STORAGE_PREFIX) &&
          key !== BLOCKED_KEY &&
          !keep.has(key),
      );
      if (expired.length) await storage.remove(expired);
    } catch (error) {
      console.warn("Actions Enhanced could not read its step cache.", error);
    }
  })();
  return hydration;
};

const rememberSteps = async (
  target: JobTarget,
  value: JobStep[],
  fetchedAt: number,
) => {
  cache.set(target.key, { value, fetchedAt });
  try {
    await extensionStorage()?.set({
      [`${STORAGE_PREFIX}${target.key}`]: { value, fetchedAt },
    });
  } catch (error) {
    console.warn("Actions Enhanced could not save its step cache.", error);
  }
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache].find(
      ([key, entry]) => key !== target.key && !entry.promise,
    );
    if (oldest) cache.delete(oldest[0]);
  }
};

let activeRequests = 0;
const pendingRequests: (() => void)[] = [];

const loadQueuedSteps = async (
  target: JobTarget,
  fetcher: typeof fetch,
  force: boolean,
  now: number,
) => {
  if (activeRequests >= 4)
    await new Promise<void>((resolve) => pendingRequests.push(resolve));
  else activeRequests++;
  try {
    try {
      if (!force) {
        const key = `${STORAGE_PREFIX}${target.key}`;
        const stored = (await extensionStorage()?.get(key))?.[key];
        if (
          stored &&
          typeof stored === "object" &&
          "value" in stored &&
          validSteps(stored.value) &&
          "fetchedAt" in stored &&
          typeof stored.fetchedAt === "number" &&
          Date.now() - stored.fetchedAt <
            (stepsSettled(stored.value) ? RETENTION : RUNNING_STEPS_TTL)
        )
          return { value: stored.value, fetchedAt: stored.fetchedAt };
      }
      const saved = await extensionStorage()?.get(BLOCKED_KEY);
      if (typeof saved?.[BLOCKED_KEY] === "number")
        blockedUntil = Math.max(blockedUntil, saved[BLOCKED_KEY]);
    } catch (error) {
      console.warn(
        "Actions Enhanced could not read its step request cooldown.",
        error,
      );
    }
    if (Date.now() < blockedUntil)
      throw new JobStepsError(
        "rate-limit",
        `GitHub is rate-limiting step requests. Retry after ${new Date(blockedUntil).toLocaleTimeString()}.`,
      );
    return { value: await loadSteps(target, fetcher), fetchedAt: now };
  } finally {
    const next = pendingRequests.shift();
    if (next) next();
    else activeRequests--;
  }
};

export const clearJobStepsCache = () => {
  cache.clear();
  hydration = undefined;
  blockedUntil = 0;
};

export const cachedJobSteps = (jobUrl: URL): JobStep[] | undefined => {
  const target = resolveTarget(jobUrl, new URL(location.href));
  const entry = cache.get(target.key);
  if (
    entry?.value &&
    Date.now() - (entry.fetchedAt ?? 0) <
      (stepsSettled(entry.value) ? RETENTION : RUNNING_STEPS_TTL)
  )
    return entry.value;
};

const loadSteps = async (target: JobTarget, fetcher: typeof fetch) => {
  let response: Response;
  try {
    response = await fetcher(target.fetchUrl, {
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
  } catch {
    throw new JobStepsError("network", "Steps could not be loaded.");
  }
  const landed = response.url ? new URL(response.url, target.fetchUrl) : null;
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("retry-after") !== null ||
        response.headers.get("x-ratelimit-remaining") === "0"))
  ) {
    const retry = response.headers.get("retry-after");
    const delay =
      retry && /^\d+$/.test(retry)
        ? Date.now() + Number(retry) * 1000
        : retry
          ? Date.parse(retry)
          : Number.NaN;
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    blockedUntil = Math.max(
      Date.now() + 60_000,
      Number.isFinite(delay) ? delay : 0,
      reset || 0,
    );
    try {
      await extensionStorage()?.set({ [BLOCKED_KEY]: blockedUntil });
    } catch (error) {
      console.warn(
        "Actions Enhanced could not save its step request cooldown.",
        error,
      );
    }
    throw new JobStepsError(
      "rate-limit",
      `GitHub is rate-limiting step requests. Retry after ${new Date(blockedUntil).toLocaleTimeString()}.`,
      response.status,
    );
  }
  if (
    [401, 403, 404].includes(response.status) ||
    (landed &&
      (landed.origin !== new URL(target.fetchUrl).origin ||
        !landed.pathname.startsWith(target.jobPath)))
  )
    throw new JobStepsError(
      "access",
      "You do not have access to this job's steps.",
      response.status,
    );
  if (!response.ok)
    throw new JobStepsError(
      "http",
      `Steps request failed (HTTP ${response.status}).`,
      response.status,
    );
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const steps = readNativeJobSteps(doc);
  if (!steps.length && !stepRoots(doc).length)
    throw new JobStepsError("no-steps", "No steps were found for this job.");
  return steps;
};

// Reads the visible native job first; otherwise fetches the same-origin job
// page with the user's existing session. Settled jobs are cached for reuse,
// running jobs for a short TTL; rate-limit cooldowns persist across pages.
export const requestJobSteps = async (
  jobUrl: URL,
  options: {
    fetcher?: typeof fetch;
    now?: number;
    force?: boolean;
    current?: URL;
  } = {},
): Promise<JobStep[]> => {
  const {
    fetcher = (...args: Parameters<typeof fetch>) => fetch(...args),
    now = Date.now(),
    force = false,
    current = new URL(location.href),
  } = options;
  await hydrate();
  let target: JobTarget;
  try {
    target = resolveTarget(jobUrl, current);
  } catch (error) {
    return Promise.reject(error);
  }
  const requestedAttempt = attemptFor(jobUrl);
  if (
    selectedJobPathFor(current) === target.jobPath &&
    (!requestedAttempt || requestedAttempt === attemptFor(current))
  ) {
    const visible = readNativeJobSteps(document);
    if (
      visible.length &&
      visible.every(
        (step) =>
          step.startedAt !== null ||
          step.status === "queued" ||
          step.status === "skipped",
      )
    ) {
      await rememberSteps(target, visible, now);
      return visible;
    }
  }
  const entry = cache.get(target.key);
  if (entry?.promise) return entry.promise;
  if (!force && entry?.value) {
    if (stepsSettled(entry.value) && now - (entry.fetchedAt ?? 0) < RETENTION)
      return Promise.resolve(entry.value);
    if (now - (entry.fetchedAt ?? 0) < RUNNING_STEPS_TTL)
      return Promise.resolve(entry.value);
  }
  const promise = (async () => {
    try {
      const { value, fetchedAt } = await loadQueuedSteps(
        target,
        fetcher,
        force,
        now,
      );
      await rememberSteps(target, value, fetchedAt);
      return value;
    } catch (error) {
      cache.delete(target.key);
      throw error;
    }
  })();
  cache.delete(target.key);
  cache.set(target.key, { promise });
  return promise;
};

export const jobStepHref = (
  jobUrl: URL,
  number: number,
  current = new URL(location.href),
) => {
  const next = new URL(jobHref(jobUrl.href, current));
  const attempt = attemptFor(jobUrl);
  if (attempt && /^[1-9]\d*$/.test(attempt))
    next.searchParams.set("attempt", attempt);
  next.searchParams.set("ae_tab", "log");
  next.searchParams.set("ae_step", String(number));
  return next.href;
};

import type { browser } from "wxt/browser";
