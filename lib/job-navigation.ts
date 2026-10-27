import type { Item } from "./github";

export type JobFilter = "all" | "attention" | "active" | "failure" | "success";
export type NavigationState = {
  runPath: string;
  query: string;
  filter: JobFilter;
  scrollTop: number;
};

const storageKey = "actions-enhanced:job-navigation";

export const runPathFor = (pathname: string) =>
  pathname.match(/^\/[^/]+\/[^/]+\/actions\/runs\/\d+(?=\/|$)/)?.[0] ?? "";

export const readNavigationState = (
  runPath: string,
): {
  state: NavigationState;
  error: string;
} => {
  const fallback: NavigationState = {
    runPath,
    query: "",
    filter: "all",
    scrollTop: 0,
  };
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { state: fallback, error: "" };
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("runPath" in value) ||
      value.runPath !== runPath
    )
      return { state: fallback, error: "" };
    if (
      !("query" in value) ||
      typeof value.query !== "string" ||
      !("filter" in value) ||
      !isJobFilter(value.filter) ||
      !("scrollTop" in value) ||
      typeof value.scrollTop !== "number" ||
      !Number.isFinite(value.scrollTop) ||
      value.scrollTop < 0
    )
      throw new Error("Invalid saved job navigation state.");
    return {
      state: {
        runPath,
        query: value.query,
        filter: value.filter,
        scrollTop: value.scrollTop,
      },
      error: "",
    };
  } catch {
    return {
      state: fallback,
      error: "Job navigation could not be restored. Filters were reset.",
    };
  }
};

export const saveNavigationState = (state: NavigationState): string => {
  if (!state.runPath) return "";
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(state));
    return "";
  } catch {
    return "This tab cannot remember job navigation. Filters will reset between pages.";
  }
};

export const jobNavigation = (items: Item[], selected: string) => {
  const currentIndex = items.findIndex(
    ({ id }) => id.replace(/\/$/, "") === selected,
  );
  const failures = items.filter(({ status }) => status === "failure");
  const failureIndex = failures.findIndex(
    ({ id }) => id.replace(/\/$/, "") === selected,
  );
  const before = currentIndex < 0 ? [] : items.slice(0, currentIndex);
  const after = currentIndex < 0 ? items : items.slice(currentIndex + 1);
  return {
    currentIndex,
    currentItem: items[currentIndex],
    previous: items[currentIndex - 1],
    next: currentIndex < 0 ? undefined : items[currentIndex + 1],
    failures,
    failureIndex,
    previousFailure:
      before.findLast(({ status }) => status === "failure") ?? failures.at(-1),
    nextFailure:
      after.find(({ status }) => status === "failure") ?? failures[0],
    attention: items.filter(
      ({ status }) => status === "failure" || status === "action_required",
    ).length,
    active: items.filter(
      ({ status }) => status === "queued" || status === "in_progress",
    ).length,
    passed: items.filter(({ status }) => status === "success").length,
  };
};

const isJobFilter = (value: unknown): value is JobFilter =>
  value === "all" ||
  value === "attention" ||
  value === "active" ||
  value === "failure" ||
  value === "success";

export const revealInSidebar = (
  pane: HTMLElement,
  link: HTMLElement,
  controlsHeight: number,
) => {
  const parent = pane.getBoundingClientRect();
  const target = link.getBoundingClientRect();
  const top = parent.top + controlsHeight + 8;
  if (target.top < top) pane.scrollTop -= top - target.top;
  else if (target.bottom > parent.bottom - 8)
    pane.scrollTop += target.bottom - parent.bottom + 8;
};
