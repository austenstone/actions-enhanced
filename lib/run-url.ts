import { runPathFor } from "./job-navigation";

export const runViews = [
  "summary",
  "run-summary",
  "table",
  "graph",
  "waterfall",
  "annotations",
  "artifacts",
] as const;
export type RunView = (typeof runViews)[number];

export const currentRunView = (url: URL): RunView => {
  const value = url.searchParams.get("ae_view");
  return runViews.find((view) => view === value) ?? "summary";
};

export const logLayouts = [
  "side",
  "below",
  "maximized",
  "fullscreen",
  "closed",
] as const;
export type LogLayout = (typeof logLayouts)[number];

export const currentLogLayout = (url: URL): LogLayout => {
  const value = url.searchParams.get("ae_layout");
  return logLayouts.find((layout) => layout === value) ?? "side";
};

export const selectedJobPath = (url: URL) => {
  const run = runPathFor(url.pathname);
  if (!run) return "";
  const job =
    url.pathname.match(/\/job\/(\d+)\/?$/)?.[1] ??
    url.searchParams.get("ae_job");
  return job && /^\d+$/.test(job) ? `${run}/job/${job}` : "";
};

export const jobHref = (
  href: string,
  current = new URL(location.href),
): string => {
  const next = new URL(href, current);
  if (
    next.origin !== current.origin ||
    runPathFor(next.pathname) !== runPathFor(current.pathname)
  )
    return next.href;
  const view = currentRunView(current);
  const tab = current.searchParams.get("ae_tab");
  if (tab === "annotations" || tab === "details")
    next.searchParams.set("ae_tab", tab);
  if (view === "summary") next.searchParams.delete("ae_view");
  else next.searchParams.set("ae_view", view);
  next.searchParams.delete("ae_job");
  const layout = currentLogLayout(current);
  if (layout === "side" || layout === "closed")
    next.searchParams.delete("ae_layout");
  else next.searchParams.set("ae_layout", layout);
  const attempt =
    current.pathname.match(/\/attempts\/([1-9]\d*)\/?$/)?.[1] ??
    current.searchParams.get("attempt");
  if (
    attempt &&
    /^[1-9]\d*$/.test(attempt) &&
    !next.searchParams.has("attempt")
  )
    next.searchParams.set("attempt", attempt);
  return next.href;
};

export const runViewHref = (
  view: RunView,
  current = new URL(location.href),
): string => {
  const next = new URL(current);
  const run = runPathFor(next.pathname);
  if (!run) return next.href;
  const selected = selectedJobPath(current);
  if (
    view === "graph" ||
    view === "run-summary" ||
    view === "annotations" ||
    view === "artifacts"
  ) {
    const attempt =
      current.pathname.match(/\/attempts\/([1-9]\d*)\/?$/)?.[1] ??
      current.searchParams.get("attempt");
    next.pathname =
      attempt && /^[1-9]\d*$/.test(attempt)
        ? `${run}/attempts/${attempt}`
        : run;
    if (selected)
      next.searchParams.set("ae_job", selected.split("/").at(-1) ?? "");
  }
  if (view === "summary") next.searchParams.delete("ae_view");
  else next.searchParams.set("ae_view", view);
  return next.href;
};
