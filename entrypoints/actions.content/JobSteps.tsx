import { useCallback, useEffect, useState } from "react";
import { disclosurePath } from "../../lib/disclosure-icon";
import { type Status, statusLabels } from "../../lib/github";
import {
  type JobStep,
  JobStepsError,
  jobStepHref,
  RUNNING_STEPS_TTL,
  requestJobSteps,
  stepsSettled,
} from "../../lib/job-steps";
import "./job-steps.css";

type StepsState =
  | { kind: "loading" }
  | { kind: "loaded"; steps: JobStep[] }
  | { kind: "error"; message: string };

export const stepStatusLabel = (status: string) =>
  status in statusLabels ? statusLabels[status as Status] : status;

export const useJobSteps = (jobUrl: string, active: boolean) => {
  const [state, setState] = useState<StepsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (showLoading: boolean) => {
      if (showLoading) setState({ kind: "loading" });
      try {
        const steps = await requestJobSteps(new URL(jobUrl, location.href));
        if (cancelled) return;
        setState({ kind: "loaded", steps });
        if (!stepsSettled(steps))
          timer = setTimeout(() => load(false), RUNNING_STEPS_TTL);
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            error instanceof JobStepsError
              ? error.message
              : "Steps could not be loaded.",
        });
      }
    };
    load(true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobUrl, active, attempt]);
  return { state, retry };
};

export const JobStepsToggle = ({
  expanded,
  onToggle,
  controls,
  jobName,
}: {
  expanded: boolean;
  onToggle: () => void;
  controls: string;
  jobName: string;
}) => (
  <button
    type="button"
    className="ae-job-steps-toggle"
    aria-expanded={expanded}
    aria-controls={controls}
    aria-label={`${expanded ? "Hide" : "Show"} steps for ${jobName}`}
    onClick={onToggle}
  >
    <svg
      className="octicon octicon-chevron-down"
      data-component="Octicon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="16"
      height="16"
    >
      <path d={disclosurePath} />
    </svg>
  </button>
);

const stepTone = (status: string) =>
  status === "success"
    ? "passed"
    : status === "failure"
      ? "failed"
      : status === "in_progress"
        ? "in_progress"
        : "muted";

export type StepTimeline = { start: number; span: number; now: number };

export const JobStepList = ({
  id,
  jobUrl,
  jobName,
  timeline,
}: {
  id: string;
  jobUrl: string;
  jobName: string;
  timeline?: StepTimeline | null;
}) => {
  const { state, retry } = useJobSteps(jobUrl, true);
  const steps =
    state.kind === "loaded"
      ? state.steps.filter((step) => step.status !== "skipped")
      : [];
  const url = new URL(jobUrl, location.href);
  const mode = timeline === undefined ? "list" : "timeline";
  return (
    <div
      id={id}
      className={`ae-job-steps ae-job-steps-${mode}`}
      role="group"
      aria-label={`Steps for ${jobName}`}
      aria-busy={state.kind === "loading"}
    >
      {state.kind === "loading" && (
        <p className="ae-job-steps-message color-fg-muted" role="status">
          Loading steps…
        </p>
      )}
      {state.kind === "error" && (
        <p className="ae-job-steps-message" role="alert">
          <span className="color-fg-danger">{state.message}</span>{" "}
          <button
            type="button"
            className="btn-link"
            onClick={retry}
            aria-label={`Retry loading steps for ${jobName}`}
          >
            Retry
          </button>
        </p>
      )}
      {state.kind === "loaded" && !steps.length && (
        <p className="ae-job-steps-message color-fg-muted">
          {state.steps.length ? "No non-skipped steps" : "No steps"}
        </p>
      )}
      {state.kind === "loaded" && steps.length > 0 && (
        <ol className="ae-job-steps-list">
          {steps.map((step) => {
            const status = stepStatusLabel(step.status);
            const interval =
              timeline && step.startedAt !== null
                ? {
                    start: step.startedAt,
                    end:
                      step.completedAt ??
                      (step.status === "in_progress" ? timeline.now : null),
                  }
                : null;
            return (
              <li key={step.number} className="ae-job-step">
                <div className="ae-job-step-label">
                  <span
                    className={`ae-job-step-dot ae-job-step-${stepTone(step.status)}`}
                    aria-hidden="true"
                  />
                  <a
                    href={jobStepHref(url, step.number)}
                    title={step.name}
                    aria-label={`${step.name}: ${status}${step.duration ? `, ${step.duration}` : ""}`}
                  >
                    {step.name}
                  </a>
                  {mode === "list" && (
                    <span className="ae-job-step-status color-fg-muted f6">
                      {status}
                    </span>
                  )}
                </div>
                {mode === "list" ? (
                  <span className="ae-job-step-duration color-fg-muted f6">
                    {step.duration ?? ""}
                  </span>
                ) : (
                  <div className="ae-job-step-lane color-fg-muted f6">
                    {timeline && interval?.end != null ? (
                      <div className="ae-job-step-track">
                        <span
                          className={`ae-job-step-bar ae-job-step-${stepTone(step.status)}`}
                          style={{
                            left: `${Math.max(0, ((interval.start - timeline.start) / timeline.span) * 100)}%`,
                            width: `${Math.min(100, ((interval.end - interval.start) / timeline.span) * 100)}%`,
                          }}
                          aria-hidden="true"
                        />
                        <span
                          className="ae-job-step-elapsed"
                          style={{
                            left: `${Math.min(100, Math.max(0, ((interval.end - timeline.start) / timeline.span) * 100))}%`,
                          }}
                        >
                          {step.duration ?? status}
                        </span>
                      </div>
                    ) : (
                      <span>
                        {status} · {step.duration ?? "Duration unknown"} ·
                        Timing unavailable
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
