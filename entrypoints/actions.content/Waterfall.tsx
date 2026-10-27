import { useCallback, useEffect, useRef, useState } from "react";
import type { Surface } from "../../lib/github";
import {
  executionInterval,
  type JobTiming,
  queueInterval,
  readTimingContext,
  type TimingContext,
} from "../../lib/job-timing";
import {
  isSettled,
  MIN_LIVE_DELAY,
  nextLiveDelay,
  peekJobTiming,
  RATE_RESERVE,
  requestJobTiming,
} from "../../lib/job-timing-cache";
import {
  compareWithPage,
  type NativeJob,
  nativeSignature,
  readNativeJobs,
  readNativeStepBounds,
} from "../../lib/native-job-timing";
import { WaterfallTimeline } from "./WaterfallTimeline";
import "./waterfall.css";

const MAX_LIVE_REFRESHES = 60;
const PAGE_CHANGE_GAP = 15_000;

type Live =
  | { state: "idle" | "settled" | "live" }
  | { state: "paused"; reason: string };

const readContext = (surface: Surface): TimingContext | string => {
  try {
    const context = readTimingContext(new URL(location.href), document);
    return surface.kind === "jobs" && context.repository === surface.repository
      ? context
      : "Open a workflow run to see its job timing.";
  } catch (failure) {
    return failure instanceof Error ? failure.message : "Job timing failed.";
  }
};

export const Waterfall = ({ surface }: { surface: Surface }) => {
  const route = `${location.pathname}${location.search}`;
  const [context, setContext] = useState(() => readContext(surface));
  const [data, setData] = useState<JobTiming | null>(() =>
    typeof context === "string" ? null : peekJobTiming(context),
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [live, setLive] = useState<Live>({ state: "idle" });
  const [nativeJobs, setNativeJobs] = useState<NativeJob[]>(() =>
    typeof context === "string"
      ? []
      : readNativeJobs(document, context.runPath, location.origin),
  );
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const generation = useRef(0);
  const refreshes = useRef(0);
  const lastPageRefresh = useRef(0);

  useEffect(() => {
    const next = readContext(surface);
    setContext(next);
    setData(typeof next === "string" ? null : peekJobTiming(next));
    setError("");
    setLive({ state: "idle" });
    refreshes.current = 0;
  }, [route, surface]);

  const load = useCallback(
    async (force = false) => {
      if (typeof context === "string") return;
      const run = ++generation.current;
      setLoading(true);
      try {
        const result = await requestJobTiming(context, { force });
        if (run !== generation.current) return;
        setNow(Date.now());
        setData(result);
        setError("");
      } catch (failure) {
        if (run !== generation.current) return;
        setData(peekJobTiming(context));
        setError(
          failure instanceof Error ? failure.message : "Job timing failed.",
        );
        setLive({
          state: "paused",
          reason: "Live updates stopped after an error.",
        });
      } finally {
        if (run === generation.current) setLoading(false);
      }
    },
    [context],
  );

  useEffect(() => {
    if (typeof context === "string") return;
    load();
    return () => {
      generation.current++;
    };
  }, [context, load]);

  useEffect(() => {
    if (typeof context === "string") return;
    let frame = 0;
    let signature = nativeSignature(nativeJobs);
    const observer = new MutationObserver((records) => {
      if (
        frame ||
        records.every(({ target }) =>
          (target instanceof Element ? target : target.parentElement)?.closest(
            "[data-actions-enhanced]",
          ),
        )
      )
        return;
      frame = window.setTimeout(() => {
        frame = 0;
        const jobs = readNativeJobs(document, context.runPath, location.origin);
        const next = nativeSignature(jobs);
        if (next === signature) return;
        signature = next;
        setNativeJobs(jobs);
      }, 500);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "aria-label", "href"],
    });
    return () => {
      observer.disconnect();
      window.clearTimeout(frame);
    };
  }, [context, nativeJobs]);

  const bounds =
    typeof context === "string"
      ? null
      : readNativeStepBounds(document, context.jobId);
  const comparison = data ? compareWithPage(data, nativeJobs, bounds) : null;

  useEffect(() => {
    if (!data || loading || error) return;
    if (isSettled(data)) {
      setLive({ state: "settled" });
      return;
    }
    if (refreshes.current >= MAX_LIVE_REFRESHES) {
      setLive({
        state: "paused",
        reason: "Live updates paused after an hour. Refresh to continue.",
      });
      return;
    }
    const pageNewer =
      comparison?.pageNewer &&
      (data.rateLimit.remaining ?? RATE_RESERVE + 1) > RATE_RESERVE;
    const delay = pageNewer
      ? Math.max(
          0,
          lastPageRefresh.current + PAGE_CHANGE_GAP - Date.now(),
          data.fetchedAt + PAGE_CHANGE_GAP - Date.now(),
        )
      : nextLiveDelay(data);
    if (delay === null) {
      setLive({
        state: "paused",
        reason:
          "Live updates paused to stay within GitHub's unauthenticated rate limit.",
      });
      return;
    }
    setLive({ state: "live" });
    if (!visible) return;
    const timer = window.setTimeout(() => {
      refreshes.current++;
      if (pageNewer) lastPageRefresh.current = Date.now();
      load(pageNewer || delay >= MIN_LIVE_DELAY);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [data, loading, error, comparison?.pageNewer, load, visible]);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (
      !data?.jobs.some(
        (job) =>
          executionInterval(job, now)?.ongoing ||
          queueInterval(job, now)?.ongoing,
      )
    )
      return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data, now]);

  const warnings = [
    ...(data?.incomplete ?? []),
    ...(comparison?.warnings ?? []),
  ];
  return (
    <section
      className="ae-waterfall"
      aria-label="Job execution waterfall"
      aria-busy={loading}
    >
      {typeof context === "string" && (
        <p role="alert" className="ae-waterfall-message color-fg-danger">
          {context}
        </p>
      )}
      {loading && !data && (
        <p className="ae-waterfall-message" role="status">
          Loading exact job timestamps for this attempt…
        </p>
      )}
      {error && (
        <p role="alert" className="ae-waterfall-message color-fg-danger">
          {error}
          {data && " Showing the last successful snapshot."}
        </p>
      )}
      {error && !data && nativeJobs.length > 0 && (
        <p className="ae-waterfall-message color-fg-muted">
          The page lists {nativeJobs.length} job
          {nativeJobs.length === 1 ? "" : "s"} with rounded durations, but no
          start or end times, so they cannot be placed on a shared timeline.
        </p>
      )}
      {data && (
        <>
          {live.state === "paused" && !error && (
            <div
              role="status"
              className="flash flash-warn ae-waterfall-warning"
            >
              {live.reason}
            </div>
          )}
          {warnings.length > 0 && (
            <div
              role="status"
              className="flash flash-warn ae-waterfall-warning"
            >
              <strong>Incomplete coverage.</strong> {warnings.join(" ")}
            </div>
          )}
          {data.jobs.length ? (
            <WaterfallTimeline data={data} now={now} />
          ) : (
            <p className="ae-waterfall-message">
              No jobs were returned for this attempt.
            </p>
          )}
        </>
      )}
    </section>
  );
};
