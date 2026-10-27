import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { filterItems, filterNativeItems, type Surface } from "../../lib/github";
import {
  type JobFilter,
  jobNavigation,
  type NavigationState,
  readNavigationState,
  revealInSidebar,
  runPathFor,
  saveNavigationState,
} from "../../lib/job-navigation";
import { jobHref, selectedJobPath } from "../../lib/run-url";

class SafeBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[Actions Enhanced] Controls failed. Native items restored.",
      error,
      info,
    );
  }
  override render() {
    return this.state.failed ? (
      <p role="alert" className="color-fg-danger">
        Extra Actions controls failed to load. GitHub's original view is
        unchanged. Reload to retry.
      </p>
    ) : (
      this.props.children
    );
  }
}

const NativeControls = ({ surface }: { surface: Surface }) => {
  const { items, kind, targets, anchor } = surface;
  const isJobs = kind === "jobs";
  const [initial] = useState(() =>
    isJobs
      ? readNavigationState(runPathFor(location.pathname))
      : {
          state: {
            runPath: "",
            query: "",
            filter: "all" as const,
            scrollTop: 0,
          },
          error: "",
        },
  );
  const [query, setQuery] = useState(initial.state.query);
  const [filter, setFilter] = useState<JobFilter>(initial.state.filter);
  const [storageError, setStorageError] = useState(initial.error);
  const [, refreshLocation] = useState(0);
  const controls = useRef<HTMLDivElement>(null);
  const pane = isJobs ? anchor.closest<HTMLElement>(".PageLayout-pane") : null;
  const state = useRef<NavigationState>(initial.state);
  const restored = useRef<{ pane: HTMLElement | null; selected: string }>({
    pane: null,
    selected: "",
  });
  state.current = { ...state.current, query, filter };
  const currentUrl = new URL(location.href);
  const selected = isJobs ? selectedJobPath(currentUrl) : "";
  const shown = useMemo(
    () => filterItems(items, query, filter, "", false),
    [items, query, filter],
  );
  const {
    currentIndex,
    currentItem,
    previous,
    next,
    failures,
    failureIndex,
    previousFailure,
    nextFailure,
    attention,
    active,
    passed,
  } = jobNavigation(items, selected);
  const currentTarget = targets.find(({ id }) => id === currentItem?.id);
  const selectedOutsideFilter =
    isJobs && currentItem && !shown.some(({ id }) => id === currentItem.id);
  const filtering = query.length > 0 || filter !== "all";

  useEffect(() => {
    const refresh = () => refreshLocation((version) => version + 1);
    window.addEventListener("popstate", refresh);
    window.addEventListener("wxt:locationchange", refresh);
    document.addEventListener("turbo:load", refresh);
    document.addEventListener("turbo:render", refresh);
    return () => {
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("wxt:locationchange", refresh);
      document.removeEventListener("turbo:load", refresh);
      document.removeEventListener("turbo:render", refresh);
    };
  }, []);

  useLayoutEffect(() => {
    if (!filtering) return;
    const visible = new Set(shown.map(({ id }) => id));
    if (isJobs && currentItem) visible.add(currentItem.id);
    targets.forEach(({ id, element }) => {
      if (element.contains(document.activeElement)) visible.add(id);
    });
    return filterNativeItems(targets, visible);
  }, [filtering, targets, shown, isJobs, currentItem]);

  useLayoutEffect(() => {
    if (!isJobs || !pane) return;
    const prior = pane.getAttribute("data-ae-job-pane");
    pane.setAttribute("data-ae-job-pane", "");
    const frame = requestAnimationFrame(() => {
      if (restored.current.pane !== pane)
        pane.scrollTop = state.current.scrollTop;
      if (
        currentTarget &&
        (restored.current.pane !== pane ||
          restored.current.selected !== selected)
      )
        revealInSidebar(
          pane,
          currentTarget.element,
          controls.current?.offsetHeight ?? 0,
        );
      restored.current = { pane, selected };
      state.current.scrollTop = pane.scrollTop;
    });
    const onScroll = () => {
      state.current.scrollTop = pane.scrollTop;
      const error = saveNavigationState(state.current);
      if (error) setStorageError(error);
    };
    pane.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      pane.removeEventListener("scroll", onScroll);
      if (prior === null) pane.removeAttribute("data-ae-job-pane");
      else pane.setAttribute("data-ae-job-pane", prior);
    };
  }, [isJobs, pane, selected, currentTarget?.element]);

  useLayoutEffect(() => {
    if (!isJobs) return;
    const error = saveNavigationState(state.current);
    if (error) setStorageError(error);
  }, [isJobs, query, filter]);

  useEffect(() => {
    if (!isJobs) return;
    const save = () => {
      if (pane?.isConnected) state.current.scrollTop = pane.scrollTop;
      const error = saveNavigationState(state.current);
      if (error) setStorageError(error);
    };
    window.addEventListener("pagehide", save);
    const saveBeforeNavigation = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]"))
        save();
    };
    document.addEventListener("click", saveBeforeNavigation, true);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("click", saveBeforeNavigation, true);
    };
  }, [isJobs, pane]);

  useEffect(() => {
    if (!isJobs) return;
    const carryView = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link || !anchor.contains(link) || event.defaultPrevented) return;
      const url = new URL(link.href);
      const current = new URL(location.href);
      if (
        url.origin !== current.origin ||
        !selectedJobPath(url) ||
        url.pathname.replace(/\/$/, "") !== selectedJobPath(url) ||
        runPathFor(url.pathname) !== state.current.runPath
      )
        return;
      const original = link.getAttribute("href");
      const href = jobHref(link.href, current);
      if (href === link.href) return;
      link.setAttribute("href", href);
      // Let the browser and Turbo consume the real anchor, including modified clicks.
      window.setTimeout(() => {
        if (link.getAttribute("href") === href && original !== null)
          link.setAttribute("href", original);
      }, 0);
    };
    document.addEventListener("click", carryView, true);
    document.addEventListener("auxclick", carryView, true);
    return () => {
      document.removeEventListener("click", carryView, true);
      document.removeEventListener("auxclick", carryView, true);
    };
  }, [isJobs, anchor]);

  const reset = () => {
    setQuery("");
    setFilter("all");
  };
  const focusFirstMatch = () => {
    const target = targets.find(({ id }) => id === shown[0]?.id)?.element;
    const link = target?.matches("a")
      ? target
      : target?.querySelector<HTMLAnchorElement>("a[href]");
    link?.focus();
  };

  return (
    <div
      className={`ae-native-controls ${isJobs ? "ae-job-controls" : ""}`}
      role="region"
      aria-label="Extra Actions controls"
      ref={controls}
    >
      <input
        className="form-control input-sm ae-local-search"
        type="search"
        aria-label={`Filter loaded ${kind}`}
        placeholder={isJobs ? "Find a job..." : "Filter loaded runs..."}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            reset();
          }
          if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            focusFirstMatch();
          }
        }}
      />
      {isJobs ? (
        <select
          className="form-select select-sm"
          aria-label="Filter jobs by status"
          value={filter}
          onChange={(event) => {
            const value = event.target.value;
            if (
              value === "all" ||
              value === "failure" ||
              value === "attention" ||
              value === "active" ||
              value === "success"
            )
              setFilter(value);
          }}
        >
          <option value="all">All jobs ({items.length})</option>
          <option value="failure">Failed ({failures.length})</option>
          <option value="attention">Needs attention ({attention})</option>
          <option value="active">Running / queued ({active})</option>
          <option value="success">Passed ({passed})</option>
        </select>
      ) : (
        <button
          className="btn btn-sm"
          type="button"
          aria-pressed={filter === "attention"}
          onClick={() =>
            setFilter(filter === "attention" ? "all" : "attention")
          }
        >
          Needs attention ({attention})
        </button>
      )}
      {filtering && (
        <button className="btn btn-sm" type="button" onClick={reset}>
          Show all
        </button>
      )}
      {isJobs && currentItem && (
        <div className="ae-job-pager" role="group" aria-label="Job navigation">
          {previous ? (
            <a
              className="btn btn-sm"
              href={jobHref(previous.url, currentUrl)}
              aria-label="Previous job"
            >
              Previous
            </a>
          ) : (
            <button
              className="btn btn-sm"
              type="button"
              disabled
              aria-label="Previous job"
            >
              Previous
            </button>
          )}
          <span className="color-fg-muted f6">
            {currentIndex + 1} of {items.length}
          </span>
          {next ? (
            <a
              className="btn btn-sm"
              href={jobHref(next.url, currentUrl)}
              aria-label="Next job"
            >
              Next
            </a>
          ) : (
            <button
              className="btn btn-sm"
              type="button"
              disabled
              aria-label="Next job"
            >
              Next
            </button>
          )}
        </div>
      )}
      {isJobs && nextFailure && (
        <div
          className="ae-job-pager"
          role="group"
          aria-label="Failed job navigation"
        >
          {failureIndex >= 0 && failures.length > 1 && (
            <a
              className="btn btn-sm"
              href={previousFailure && jobHref(previousFailure.url, currentUrl)}
            >
              Previous failed
            </a>
          )}
          {failureIndex < 0 || failures.length > 1 ? (
            <a
              className="btn btn-sm"
              href={jobHref(nextFailure.url, currentUrl)}
            >
              {currentIndex < 0 ? "First failed job" : "Next failed job"}
            </a>
          ) : null}
          <span className="color-fg-muted f6">
            {failureIndex >= 0
              ? `Failure ${failureIndex + 1} of ${failures.length}`
              : `${failures.length} failed`}
          </span>
        </div>
      )}
      <span className="color-fg-muted f6" aria-live="polite">
        {shown.length} of {items.length} loaded {kind}
        {selectedOutsideFilter ? " · current job kept visible" : ""}
      </span>
      {filtering && shown.length === 0 && (
        <span className="color-fg-muted f6">
          No matches. Clear filters to show all.
        </span>
      )}
      {storageError && (
        <span className="color-fg-attention f6" role="status">
          {storageError}
        </span>
      )}
    </div>
  );
};

export const App = ({ surface }: { surface: Surface }) => (
  <SafeBoundary>
    <NativeControls
      key={`${surface.kind}:${runPathFor(location.pathname)}`}
      surface={surface}
    />
  </SafeBoundary>
);
