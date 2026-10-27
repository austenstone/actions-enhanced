import { readStatus, type Status } from "./github";
import { type JobTiming, parseJobTime } from "./job-timing";

export type NativeJob = {
  id: number;
  name: string;
  status: Status;
  duration: string;
};

export type NativeStepBounds = {
  jobId: number;
  steps: number;
  firstStartedAt: number;
  lastCompletedAt: number | null;
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const jobIdFor = (href: string, runPath: string, origin: string) => {
  try {
    const url = new URL(href, origin);
    const match = url.pathname.match(/\/job\/([1-9]\d*)\/?$/);
    return url.origin === origin &&
      url.pathname.startsWith(`${runPath}/job/`) &&
      match
      ? Number(match[1])
      : null;
  } catch {
    return null;
  }
};

// Reads only what GitHub already rendered. The run page has job identity,
// status and a rounded duration, but no per-job start/end timestamps.
export const readNativeJobs = (
  doc: Document,
  runPath: string,
  origin = "https://github.com",
): NativeJob[] => {
  const jobs = new Map<number, NativeJob>();
  doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    if (link.closest("[data-actions-enhanced]")) return;
    const id = jobIdFor(link.getAttribute("href") ?? "", runPath, origin);
    if (id === null) return;
    const status = readStatus(link);
    const name =
      text(link.querySelector('[data-target="streaming-graph-job.name"]')) ||
      text(link.querySelector('[data-component="ActionList.Item.Label"]')) ||
      text(link);
    const duration =
      Array.from(link.querySelectorAll(".text-small.color-fg-muted"))
        .map(text)
        .find((value) => /^(?:\d+(?:\.\d+)?[dhms]\s*)+$/.test(value)) ?? "";
    const known = jobs.get(id);
    jobs.set(id, {
      id,
      name: known?.name || name,
      status: known && known.status !== "unknown" ? known.status : status,
      duration: known?.duration || duration,
    });
  });
  return [...jobs.values()];
};

export const nativeSignature = (jobs: NativeJob[]) =>
  jobs.map(({ id, status }) => `${id}:${status}`).join(",");

// Step timestamps rendered on a job page bound the selected job's execution;
// they are not the job's own started_at/completed_at.
export const readNativeStepBounds = (
  doc: Document,
  jobId: number | null,
): NativeStepBounds | null => {
  if (jobId === null) return null;
  const steps = Array.from(doc.querySelectorAll("check-step")).filter(
    (step) => !step.closest("[data-actions-enhanced]"),
  );
  const starts = steps.flatMap((step) => {
    const time = parseJobTime(step.getAttribute("data-started-at"));
    return time === null ? [] : [time];
  });
  if (!starts.length) return null;
  const ends = steps.map((step) =>
    parseJobTime(step.getAttribute("data-completed-at")),
  );
  return {
    jobId,
    steps: steps.length,
    firstStartedAt: Math.min(...starts),
    lastCompletedAt: ends.every((end) => end !== null)
      ? Math.max(...ends.flatMap((end) => (end === null ? [] : [end])))
      : null,
  };
};

const apiState = (status: string, conclusion: string | null): Status =>
  status === "completed"
    ? conclusion === "success"
      ? "success"
      : ["failure", "timed_out", "startup_failure"].includes(conclusion ?? "")
        ? "failure"
        : conclusion === "action_required"
          ? "action_required"
          : conclusion === "cancelled"
            ? "cancelled"
            : conclusion === "skipped"
              ? "skipped"
              : "unknown"
    : status === "in_progress"
      ? "in_progress"
      : "queued";

export type NativeComparison = {
  warnings: string[];
  pageNewer: boolean;
};

export const compareWithPage = (
  timing: JobTiming,
  nativeJobs: NativeJob[],
  bounds: NativeStepBounds | null,
): NativeComparison => {
  const warnings: string[] = [];
  const apiJobs = new Map(timing.jobs.map((job) => [job.id, job]));
  const missing = nativeJobs.filter(({ id }) => !apiJobs.has(id));
  if (missing.length && timing.jobs.length === timing.totalCount)
    warnings.push(
      `The page shows ${missing.length} job${missing.length === 1 ? "" : "s"} missing from this API snapshot.`,
    );
  const changed = nativeJobs.filter((native) => {
    const job = apiJobs.get(native.id);
    return (
      job &&
      native.status !== "unknown" &&
      native.status !== apiState(job.status, job.conclusion)
    );
  });
  if (changed.length)
    warnings.push(
      `The page shows a newer status for ${changed.length} job${changed.length === 1 ? "" : "s"} than this API snapshot.`,
    );
  const selected = bounds ? apiJobs.get(bounds.jobId) : undefined;
  if (bounds && selected && selected.timingIssue === null) {
    const late =
      selected.startedAt !== null && selected.startedAt > bounds.firstStartedAt;
    const early =
      selected.completedAt !== null &&
      bounds.lastCompletedAt !== null &&
      selected.completedAt < bounds.lastCompletedAt;
    if (late || early)
      warnings.push(
        "The selected job's rendered step times fall outside its API execution interval.",
      );
  }
  return { warnings, pageNewer: changed.length > 0 };
};
