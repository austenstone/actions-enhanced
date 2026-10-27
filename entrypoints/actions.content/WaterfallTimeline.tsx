import { useId, useState } from "react";
import {
  executionInterval,
  formatTimingDuration,
  type JobTiming,
  queueInterval,
  type TimedJob,
  timingScale,
  timingTicks,
} from "../../lib/job-timing";
import { jobHref, selectedJobPath } from "../../lib/run-url";
import { JobStepList, JobStepsToggle } from "./JobSteps";
import { useOptionalSharedJobControls } from "./SharedJobControls";

export const timingState = (job: TimedJob) =>
  job.status !== "completed"
    ? job.status
    : job.conclusion === "success"
      ? "passed"
      : ["failure", "timed_out", "startup_failure"].includes(
            job.conclusion ?? "",
          )
        ? "failed"
        : (job.conclusion ?? "unknown");

export const WaterfallTimeline = ({
  data,
  now,
}: {
  data: JobTiming;
  now: number;
}) => {
  const shared = useOptionalSharedJobControls();
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const idPrefix = useId();
  const toggle = (id: number) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const executableJobs = data.jobs.filter(
    (job) => job.conclusion !== "skipped" && job.status !== "skipped",
  );
  const scale = timingScale(executableJobs, now);
  const ticks = scale ? timingTicks(scale.span) : [];
  const jobs = executableJobs
    .filter((job) =>
      shared ? shared.matchesJob(job.name, timingState(job)) : true,
    )
    .sort(
      (a, b) =>
        (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || a.id - b.id,
    );
  return (
    <div className="ae-timeline">
      <div
        className="ae-timeline-scroll"
        role="region"
        aria-label="Scrollable job timeline"
        tabIndex={0}
      >
        <div className="ae-timeline-grid" style={{ minWidth: "480px" }}>
          <div className="ae-timeline-ruler">
            <div className="ae-timeline-job-heading" />
            <div className="ae-timeline-ticks" aria-label="Elapsed time">
              {scale &&
                ticks.map((elapsed) => (
                  <span
                    key={elapsed}
                    style={{ left: `${(elapsed / scale.span) * 100}%` }}
                  >
                    {formatTimingDuration(elapsed).replace(/ 0[sm]/g, "")}
                  </span>
                ))}
            </div>
          </div>
          {!jobs.length && (
            <p className="ae-timeline-empty">
              No jobs with execution timing match the current filter.
            </p>
          )}
          <ul className="ae-waterfall-list">
            {jobs.map((job) => {
              const interval = executionInterval(job, now);
              const queue = queueInterval(job, now);
              const state = timingState(job);
              const elapsed = interval
                ? formatTimingDuration(interval.end - interval.start)
                : null;
              const queued = queue
                ? formatTimingDuration(queue.end - queue.start)
                : null;
              const url = new URL(
                jobHref(`${data.context.runPath}/job/${job.id}`),
              );
              url.searchParams.set("attempt", String(data.attempt));
              const open = !collapsed.has(job.id);
              const stepsId = `${idPrefix}-steps-${job.id}`;
              const label = `${job.name}: ${queued ? `queued ${queued}${queue?.ongoing ? " so far" : ""}, ` : ""}${elapsed ? `${elapsed} execution` : queue?.ongoing ? "waiting for a runner" : "timing unavailable"}; ${state}${interval?.ongoing ? ", in progress (local clock)" : ""}`;
              const tail = interval ?? queue;
              return (
                <li
                  key={job.id}
                  className={`ae-timeline-row${selectedJobPath(new URL(location.href)).endsWith(`/job/${job.id}`) ? " ae-timeline-selected" : ""}`}
                >
                  <div className="ae-timeline-job">
                    <JobStepsToggle
                      expanded={open}
                      onToggle={() => toggle(job.id)}
                      controls={stepsId}
                      jobName={job.name}
                    />
                    <span
                      className={`ae-timeline-dot ae-timing-${state}`}
                      aria-hidden="true"
                    />
                    <a href={url.href} title={job.name}>
                      {job.name}
                    </a>
                    <span className="sr-only">
                      {state.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="ae-timeline-lane">
                    <div
                      className="ae-waterfall-track"
                      style={{
                        backgroundSize: `${scale ? ((ticks[1] ?? scale.span) / scale.span) * 100 : 100}% 100%`,
                      }}
                      role="group"
                      aria-label={label}
                    >
                      {queue && scale && (
                        <span
                          className={`ae-waterfall-queue${queue.ongoing ? " ae-waterfall-ongoing" : ""}`}
                          style={{
                            left: `${((queue.start - scale.start) / scale.span) * 100}%`,
                            width: `${Math.min(100, ((queue.end - queue.start) / scale.span) * 100)}%`,
                          }}
                          title={`Queued ${queued}${queue.ongoing ? " so far" : ""}`}
                          aria-hidden="true"
                        />
                      )}
                      {interval && scale && (
                        <a
                          href={url.href}
                          className={`ae-waterfall-bar ae-timing-${state}${interval.ongoing ? " ae-waterfall-ongoing" : ""}`}
                          style={{
                            left: `${((interval.start - scale.start) / scale.span) * 100}%`,
                            width: `${Math.min(100, ((interval.end - interval.start) / scale.span) * 100)}%`,
                          }}
                          title={label}
                          aria-label={`Open ${job.name} logs`}
                        />
                      )}
                      <span
                        className="ae-timeline-elapsed color-fg-muted f6"
                        style={{
                          left: `${tail && scale ? Math.min(100, ((tail.end - scale.start) / scale.span) * 100) : 0}%`,
                        }}
                      >
                        {elapsed ??
                          (queue?.ongoing ? `Queued ${queued}` : "No timing")}
                      </span>
                    </div>
                  </div>
                  {open && (
                    <JobStepList
                      id={stepsId}
                      jobUrl={url.href}
                      jobName={job.name}
                      timeline={scale ? { ...scale, now } : null}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};
