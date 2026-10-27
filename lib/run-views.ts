import { type Item, type Surface, statusLabels } from "./github";

export type NativeSections = {
  graph: HTMLElement | null;
  annotations: HTMLElement | null;
  annotationsState: "present" | "empty" | "unavailable";
  summaryNavigation: boolean;
};

const isNative = (element: Element) =>
  !element.closest("[data-actions-enhanced]");

export const readNativeSections = (
  doc: Document,
  current: URL,
): NativeSections => {
  const nativeElement = (selector: string) =>
    Array.from(doc.querySelectorAll<HTMLElement>(selector)).find(isNative) ??
    null;
  const graph =
    nativeElement('[role="region"][aria-label="Workflow run graph"]') ??
    nativeElement("action-graph");
  const annotations = nativeElement(
    '[role="region"][aria-label="Annotations"]',
  );
  const runPath = current.pathname.match(
    /^(\/[^/]+\/[^/]+\/actions\/runs\/\d+)\/job\/\d+\/?$/,
  )?.[1];
  const summaryNavigation =
    !!runPath &&
    Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).some(
      (link) => {
        if (!isNative(link)) return false;
        try {
          const href = new URL(link.getAttribute("href") ?? "", current);
          return (
            href.origin === current.origin &&
            href.pathname.replace(/\/$/, "") === runPath &&
            (link.textContent?.trim() === "Summary" ||
              link.getAttribute("aria-label") === "Summary")
          );
        } catch {
          return false;
        }
      },
    );
  return {
    graph,
    annotations,
    annotationsState: !annotations
      ? "unavailable"
      : /\b(?:no annotations|0 annotations)\b/i.test(
            annotations.textContent ?? "",
          ) && !annotations.querySelector("annotation-message")
        ? "empty"
        : "present",
    summaryNavigation,
  };
};

export const durationSeconds = (value: string): number | null => {
  const duration = value.trim();
  if (!/^(?:\d+(?:\.\d+)?[dhms]\s*)+$/.test(duration)) return null;
  const units: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
  return Array.from(duration.matchAll(/(\d+(?:\.\d+)?)([dhms])/g)).reduce(
    (total, match) => total + Number(match[1]) * (units[match[2] ?? ""] ?? 0),
    0,
  );
};

export type JobRow = {
  item: Item;
  duration: string;
  seconds: number | null;
};
export type JobSort = {
  column: "name" | "status" | "duration";
  direction: "ascending" | "descending";
};

export const readJobRows = (surface: Surface): JobRow[] =>
  surface.items.map((item) => {
    const target = surface.targets.find(({ id }) => id === item.id)?.element;
    const stopwatch = target?.querySelector(".octicon-stopwatch");
    const nativeDuration = stopwatch?.parentElement;
    const duration =
      durationSeconds(item.duration) !== null
        ? item.duration.trim()
        : nativeDuration &&
            isNative(nativeDuration) &&
            durationSeconds(nativeDuration.textContent ?? "") !== null
          ? (nativeDuration.textContent?.trim() ?? "")
          : "";
    return { item, duration, seconds: durationSeconds(duration) };
  });

export const sortJobRows = (rows: JobRow[], sort: JobSort): JobRow[] => {
  const direction = sort.direction === "ascending" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.column === "duration") {
      if (a.seconds === null) return b.seconds === null ? 0 : 1;
      if (b.seconds === null) return -1;
      return (a.seconds - b.seconds) * direction;
    }
    const value = (row: JobRow) =>
      sort.column === "name" ? row.item.title : statusLabels[row.item.status];
    return (
      value(a).localeCompare(value(b), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction
    );
  });
};

export const stableJobOrder = (
  previous: string[],
  rows: JobRow[],
): string[] => {
  const present = new Set(rows.map(({ item }) => item.id));
  const retained = previous.filter((id) => present.has(id));
  const seen = new Set(retained);
  return [
    ...retained,
    ...rows.filter(({ item }) => !seen.has(item.id)).map(({ item }) => item.id),
  ];
};
