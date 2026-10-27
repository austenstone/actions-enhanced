import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  annotationKinds,
  readAnnotationCounts,
} from "../../lib/annotation-counts";
import { type Surface } from "../../lib/github";
import { readAnnotationCount } from "../../lib/job-details";
import {
  cachedJobSteps,
  type JobStep,
  jobStepHref,
  RUNNING_STEPS_TTL,
  requestJobSteps,
  stepsSettled,
} from "../../lib/job-steps";
import {
  currentRunView,
  jobHref,
  type RunView,
  runViewHref,
  selectedJobPath,
} from "../../lib/run-url";
import { durationSeconds, readNativeSections } from "../../lib/run-views";
import { stepStatusLabel } from "./JobSteps";
import {
  SharedJobControlsProvider,
  useSharedJobControls,
} from "./SharedJobControls";
import "./run-views.css";

const useNativeSections = (href: string) => {
  const [sections, setSections] = useState(() => {
    const nativeSections = readNativeSections(document, new URL(href));
    return {
      ...nativeSections,
      annotationsCount: nativeSectionCount("annotations"),
      annotationCounts: readAnnotationCounts(
        document.querySelector('[data-ae-native-section="annotations"]'),
      ),
      artifactsCount: nativeSectionCount("artifacts"),
    };
  });
  useLayoutEffect(() => {
    const update = () => {
      const next = readNativeSections(document, new URL(href));
      const updated = {
        ...next,
        annotationsCount: nativeSectionCount("annotations"),
        annotationCounts: readAnnotationCounts(
          document.querySelector('[data-ae-native-section="annotations"]'),
        ),
        artifactsCount: nativeSectionCount("artifacts"),
      };
      setSections((previous) =>
        (Object.keys(updated) as (keyof typeof updated)[]).every((key) =>
          key === "annotationCounts"
            ? JSON.stringify(previous[key]) === JSON.stringify(updated[key])
            : previous[key] === updated[key],
        )
          ? previous
          : updated,
      );
    };
    update();
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.every((mutation) =>
          (mutation.target instanceof Element
            ? mutation.target
            : mutation.target.parentElement
          )?.closest("[data-actions-enhanced]"),
        )
      )
        return;
      update();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["role", "aria-label", "data-ae-native-section"],
    });
    return () => observer.disconnect();
  }, [href]);
  return sections;
};

const nativeSectionCount = (kind: "annotations" | "artifacts") => {
  const section = document.querySelector<HTMLElement>(
    `[data-ae-native-section="${kind}"]`,
  );
  if (!section) return null;
  return kind === "annotations"
    ? readAnnotationCount(section)
    : section.querySelectorAll("tbody tr").length;
};

type TableStepsState =
  | { kind: "loading" }
  | { kind: "loaded"; steps: JobStep[] }
  | { kind: "error"; message: string };

const useTableSteps = (signature: string) => {
  const [initial] = useState(() => {
    const states: Record<string, TableStepsState> = {};
    const urls: string[] = JSON.parse(signature);
    for (const url of urls) {
      const steps = cachedJobSteps(new URL(url));
      if (steps) states[url] = { kind: "loaded", steps };
    }
    return states;
  });
  const entries = useRef<Record<string, TableStepsState>>(initial);
  const active = useRef(new Set<string>());
  const pump = useRef<() => void>(() => {});
  const [states, setStates] = useState(entries.current);
  const [retryCount, setRetryCount] = useState(0);
  useEffect(() => {
    const urls: string[] = JSON.parse(signature);
    const queue = urls.filter((url) => !entries.current[url]);
    let cancelled = false;
    const drain = () => {
      if (cancelled) return;
      setStates({ ...entries.current });
      while (queue.length) {
        const url = queue.shift();
        if (!url || active.current.has(url)) continue;
        active.current.add(url);
        entries.current[url] = { kind: "loading" };
        const load = async () => {
          try {
            const steps = await requestJobSteps(new URL(url));
            entries.current[url] = { kind: "loaded", steps };
          } catch (error) {
            entries.current[url] = {
              kind: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Steps could not be loaded.",
            };
          } finally {
            active.current.delete(url);
            pump.current();
          }
        };
        void load();
      }
    };
    pump.current = drain;
    drain();
    const timer = setInterval(() => {
      for (const url of urls) {
        const state = entries.current[url];
        if (
          state?.kind === "loaded" &&
          !stepsSettled(state.steps) &&
          !active.current.has(url) &&
          !queue.includes(url)
        )
          queue.push(url);
      }
      if (queue.length) drain();
    }, RUNNING_STEPS_TTL);
    return () => {
      cancelled = true;
      clearInterval(timer);
      pump.current = () => {};
    };
  }, [signature, retryCount]);
  const retry = (url: string) => {
    if (entries.current[url]?.kind !== "error") return;
    delete entries.current[url];
    setRetryCount((count) => count + 1);
  };
  return { states, retry };
};

const JobsTable = ({
  surface,
  current,
}: {
  surface: Surface;
  current: URL;
}) => {
  const [sort, setSort] = useState<{
    column: "job" | "name" | "status" | "duration";
    direction: "ascending" | "descending";
  } | null>(null);
  const [page, setPage] = useState(0);
  const { matchesJob } = useSharedJobControls();
  const jobs = surface.items.map((item) => {
    const url = new URL(jobHref(item.url, current));
    const attempt = url.searchParams.get("attempt");
    url.search = "";
    url.hash = "";
    if (attempt) url.searchParams.set("attempt", attempt);
    return { item, url: url.href };
  });
  const signature = JSON.stringify(jobs.map(({ url }) => url).sort());
  const { states, retry } = useTableSteps(signature);
  const matching = jobs.filter(({ item }) =>
    matchesJob(item.title, item.status),
  );
  const rows = matching.flatMap(({ item, url }) => {
    const state = states[url];
    return state?.kind === "loaded"
      ? state.steps
          .filter((step) => step.status !== "skipped")
          .map((step) => ({ item, url, step }))
      : [];
  });
  if (sort) {
    const direction = sort.direction === "ascending" ? 1 : -1;
    rows.sort((a, b) => {
      if (sort.column === "duration") {
        const seconds = (step: JobStep) =>
          step.startedAt !== null && step.completedAt !== null
            ? (step.completedAt - step.startedAt) / 1000
            : step.duration && /^\d+(?:\.\d+)?ms$/.test(step.duration)
              ? Number.parseFloat(step.duration) / 1000
              : durationSeconds(step.duration ?? "");
        const left = seconds(a.step);
        const right = seconds(b.step);
        if (left === null) return right === null ? 0 : 1;
        if (right === null) return -1;
        return (left - right) * direction;
      }
      const value = (row: (typeof rows)[number]) =>
        sort.column === "job"
          ? row.item.title
          : sort.column === "name"
            ? row.step.name
            : stepStatusLabel(row.step.status);
      return (
        value(a).localeCompare(value(b), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * direction
      );
    });
  }
  const selected = selectedJobPath(current);
  const pending = matching
    .filter(({ url }) => states[url]?.kind !== "loaded")
    .map(({ item, url }) => ({ item, url, step: null }));
  const allRows = [...rows, ...pending];
  const pageCount = Math.max(1, Math.ceil(allRows.length / 100));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = allRows.slice(currentPage * 100, (currentPage + 1) * 100);
  const changeSort = (column: NonNullable<typeof sort>["column"]) => {
    setPage(0);
    setSort({
      column,
      direction:
        sort?.column === column && sort.direction === "ascending"
          ? "descending"
          : "ascending",
    });
  };
  return (
    <section className="ae-run-table Box" aria-label="Loaded steps table">
      <div className="ae-run-table-scroll">
        <table className="width-full" aria-label="Job steps">
          <thead>
            <tr>
              {(["job", "name", "status", "duration"] as const).map(
                (column) => (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={
                      sort?.column === column ? sort.direction : "none"
                    }
                  >
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => changeSort(column)}
                    >
                      {column === "job"
                        ? "Job"
                        : column === "name"
                          ? "Step"
                          : column === "status"
                            ? "Status"
                            : "Duration"}
                      {sort?.column === column &&
                        (sort.direction === "ascending" ? " ↑" : " ↓")}
                    </button>
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ item, url, step }) => {
              if (!step) {
                const state = states[url];
                return (
                  <tr key={url}>
                    <td title={item.title}>{item.title}</td>
                    <td colSpan={3}>
                      {state?.kind === "error" ? (
                        <span role="alert">
                          {state.message}{" "}
                          <button
                            type="button"
                            className="btn-link"
                            aria-label={`Retry loading steps for ${item.title}`}
                            onClick={() => retry(url)}
                          >
                            Retry
                          </button>
                        </span>
                      ) : (
                        <span role="status">Loading steps…</span>
                      )}
                    </td>
                  </tr>
                );
              }
              const isSelected =
                item.id === selected &&
                current.searchParams.get("ae_step") === String(step.number);
              return (
                <tr
                  key={`${url}#${step.number}`}
                  data-ae-selected={isSelected ? "" : undefined}
                >
                  <td title={item.title}>{item.title}</td>
                  <td>
                    <a
                      href={jobStepHref(new URL(url), step.number, current)}
                      title={step.name}
                      aria-current={isSelected ? "page" : undefined}
                    >
                      {step.name}
                    </a>
                  </td>
                  <td>
                    <svg
                      className={`ae-table-status ae-table-status-${step.status}`}
                      role="img"
                      aria-label={stepStatusLabel(step.status)}
                      viewBox="0 0 16 16"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <title>{stepStatusLabel(step.status)}</title>
                      <circle cx="8" cy="8" r="6.25" />
                      {step.status === "success" ? (
                        <path d="m5 8 2 2 4-4" />
                      ) : step.status === "failure" ? (
                        <path d="m6 6 4 4m0-4-4 4" />
                      ) : step.status === "in_progress" ||
                        step.status === "queued" ? (
                        <path d="M8 4.5V8l2 1.5" />
                      ) : (
                        <path d="m4 12 8-8" />
                      )}
                    </svg>
                  </td>
                  <td>
                    {step.duration ?? (
                      <span className="color-fg-muted">Unknown</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!matching.length && (
              <tr>
                <td colSpan={4}>No loaded jobs match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <nav className="ae-table-pagination" aria-label="Steps pagination">
          <button
            type="button"
            className="btn btn-sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span aria-live="polite">
            {currentPage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={currentPage === pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
};

export type RunViewsProps = {
  surface: Surface;
  waterfall?: ReactNode;
  waterfallAvailable?: boolean;
};

export const RunViews = ({
  surface,
  waterfall,
  waterfallAvailable = false,
}: RunViewsProps) => {
  const [href, setHref] = useState(() => location.href);
  useEffect(() => {
    const update = () => setHref(location.href);
    const events = ["popstate", "turbo:load", "wxt:locationchange"];
    events.forEach((event) => window.addEventListener(event, update));
    document.addEventListener("turbo:load", update);
    return () => {
      events.forEach((event) => window.removeEventListener(event, update));
      document.removeEventListener("turbo:load", update);
    };
  }, []);
  const current = new URL(href);
  const view = currentRunView(current);
  const sections = useNativeSections(href);
  const section = view === "graph" ? sections.graph : null;
  const workspace = !!document.querySelector("[data-ae-workspace]");
  const lastFocused = useRef({ href: "", focused: false });
  useLayoutEffect(() => {
    if (lastFocused.current.href !== href)
      lastFocused.current = { href, focused: false };
    if (!section || lastFocused.current.focused) return;
    lastFocused.current.focused = true;
    const tabindex = section.getAttribute("tabindex");
    if (tabindex === null) section.setAttribute("tabindex", "-1");
    section.focus({ preventScroll: true });
    if (!workspace) section.scrollIntoView?.({ block: "start" });
    return () => {
      if (tabindex === null && section.getAttribute("tabindex") === "-1")
        section.removeAttribute("tabindex");
    };
  }, [href, section, workspace]);
  if (surface.kind !== "jobs") return null;
  const annotationCount =
    sections.annotationsCount ??
    (sections.annotations ? readAnnotationCount(sections.annotations) : null);
  const artifactsCount = sections.artifactsCount;
  const tabs: {
    view: RunView;
    label: string;
    count?: number | null;
  }[] = [
    ...(workspace || sections.summaryNavigation
      ? [{ view: "run-summary" as const, label: "Summary" }]
      : []),
    { view: "summary", label: "List" },
    { view: "table", label: "Table" },
    ...(sections.graph || sections.summaryNavigation
      ? [{ view: "graph" as const, label: "Graph" }]
      : []),
    ...(waterfallAvailable && waterfall != null
      ? [{ view: "waterfall" as const, label: "Waterfall" }]
      : []),
    ...(workspace || sections.annotations || sections.summaryNavigation
      ? [
          {
            view: "annotations" as const,
            label: "Annotations",
            count: annotationCount,
          },
        ]
      : []),
    ...(workspace || artifactsCount !== null || sections.summaryNavigation
      ? [
          {
            view: "artifacts" as const,
            label: "Artifacts",
            count: artifactsCount,
          },
        ]
      : []),
  ];
  const content = (
    <>
      {view !== "summary" &&
        view !== "run-summary" &&
        view !== "annotations" &&
        view !== "artifacts" &&
        !workspace && (
          <p className="ae-run-view-description color-fg-muted">
            Current view: {view}. GitHub’s original summary, controls and logs
            remain unchanged.{" "}
            <a href={runViewHref("summary", current)}>Return to List</a>
          </p>
        )}
      {view === "table" && <JobsTable surface={surface} current={current} />}
      {view === "waterfall" &&
        (waterfallAvailable && waterfall != null ? (
          waterfall
        ) : (
          <p>Waterfall timing is unavailable for the loaded jobs.</p>
        ))}
      {view === "graph" && !section && (
        <p>The native graph section is unavailable on this page.</p>
      )}
    </>
  );
  return (
    <SharedJobControlsProvider surface={surface}>
      <div data-actions-enhanced="run-views" className="ae-run-views">
        <nav className="UnderlineNav" aria-label="Run views">
          <div className="UnderlineNav-body">
            {tabs.map((tab) => (
              <a
                key={tab.view}
                className="UnderlineNav-item"
                href={runViewHref(tab.view, current)}
                aria-current={view === tab.view ? "page" : undefined}
                aria-label={
                  tab.view === "annotations" ? "Annotations" : undefined
                }
              >
                {tab.view !== "annotations" && tab.label}
                {tab.view === "annotations" &&
                annotationKinds.some(
                  ({ kind }) => sections.annotationCounts[kind] > 0,
                ) ? (
                  annotationKinds
                    .filter(({ kind }) => sections.annotationCounts[kind] > 0)
                    .map(({ kind, label, icon, color, path }) => (
                      <span
                        key={kind}
                        className={`ae-annotation-count ${color}`}
                        aria-label={`${sections.annotationCounts[kind]} ${sections.annotationCounts[kind] === 1 ? kind : label}`}
                      >
                        <svg
                          className={`octicon octicon-${icon}`}
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d={path} />
                        </svg>
                        {sections.annotationCounts[kind]}
                      </span>
                    ))
                ) : tab.view === "annotations" ? (
                  <span
                    className="ae-annotation-count color-fg-muted"
                    aria-label={`${tab.count ?? "Unknown"} annotations`}
                  >
                    <svg
                      className="octicon octicon-info"
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d={annotationKinds[2].path} />
                    </svg>
                    {tab.count ?? "?"}
                  </span>
                ) : (
                  tab.count !== undefined &&
                  tab.count !== null && (
                    <span
                      className="Counter CounterLabel"
                      aria-label={`${tab.count} ${tab.label.toLowerCase()}`}
                    >
                      {tab.count}
                    </span>
                  )
                )}
              </a>
            ))}
          </div>
        </nav>
        <div className="ae-run-view-content">{content}</div>
      </div>
    </SharedJobControlsProvider>
  );
};
