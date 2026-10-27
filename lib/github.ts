export const statusLabels = {
  failure: "Failed",
  action_required: "Action required",
  in_progress: "Running",
  queued: "Queued",
  success: "Passed",
  cancelled: "Cancelled",
  skipped: "Skipped",
  unknown: "Unknown",
} as const;

export type Status = keyof typeof statusLabels;
export type Item = {
  id: string;
  url: string;
  title: string;
  status: Status;
  workflow: string;
  number: string;
  branch: string;
  actor: string;
  duration: string;
  timestamp: string;
};
export type Surface = {
  kind: "runs" | "jobs";
  anchor: HTMLElement;
  nativeList: HTMLElement | null;
  items: Item[];
  repository: string;
  targets: { id: string; element: HTMLElement }[];
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

export const parseRoute = (pathname: string) => {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/actions(?:\/(.*))?\/?$/);
  if (!match) return null;
  const tail = match[3] ?? "";
  if (
    tail &&
    !/^(?:workflows\/[^/]+\/?|runs\/\d+(?:\/job\/\d+|\/attempts\/[1-9]\d*)?\/?)$/.test(
      tail,
    )
  )
    return null;
  return {
    repository: `${match[1]}/${match[2]}`,
    kind: tail.startsWith("runs/") ? ("jobs" as const) : ("runs" as const),
  };
};

export const readStatus = (element: Element): Status => {
  const icons = Array.from(element.querySelectorAll("svg"))
    .map((svg) => svg.getAttribute("class") ?? "")
    .join(" ");
  const label = [
    element.getAttribute("aria-label"),
    ...Array.from(element.querySelectorAll("[aria-label]")).map((node) =>
      node.getAttribute("aria-label"),
    ),
  ]
    .join(" ")
    .toLowerCase();
  if (/octicon-x-circle(?:\s|-|$)|octicon-stop(?:\s|$)/.test(icons))
    return "failure";
  if (/octicon-alert/.test(icons)) return "action_required";
  if (/octicon-check-circle/.test(icons)) return "success";
  if (/octicon-skip/.test(icons)) return "skipped";
  if (/octicon-circle-slash/.test(icons)) return "cancelled";
  if (/octicon-sync|octicon-dot-fill/.test(icons)) return "in_progress";
  if (/octicon-clock/.test(icons)) return "queued";
  const statusLabel = label.split(/\brun\s+\d+\s+of\s+/)[0] ?? "";
  if (/timed out|failed|failure/.test(statusLabel)) return "failure";
  if (/requires action|action required/.test(statusLabel))
    return "action_required";
  if (/completed successfully|success/.test(statusLabel)) return "success";
  if (/skipped/.test(statusLabel)) return "skipped";
  if (/cancelled|canceled/.test(statusLabel)) return "cancelled";
  if (/in progress|running/.test(statusLabel)) return "in_progress";
  if (/queued|waiting|pending/.test(statusLabel)) return "queued";
  return "unknown";
};

const safeUrl = (href: string, origin: string) => {
  try {
    const url = new URL(href, origin);
    return url.origin === origin && url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

const emptyItem = (url: URL): Item => ({
  id: url.pathname,
  url: url.href,
  title: "",
  status: "unknown",
  workflow: "",
  number: "",
  branch: "",
  actor: "",
  duration: "",
  timestamp: "",
});

export const readSurface = (doc: Document, location: URL): Surface | null => {
  const route = parseRoute(location.pathname);
  if (!route) return null;
  const prefix = `/${route.repository}/actions/runs/`;
  const graphDurations = new Map<string, string>();
  if (route.kind === "jobs") {
    doc
      .querySelectorAll<HTMLAnchorElement>("streaming-graph-job a[href]")
      .forEach((link) => {
        if (link.closest("[data-actions-enhanced]")) return;
        const url = safeUrl(link.getAttribute("href") ?? "", location.origin);
        if (!url) return;
        const durations = Array.from(
          link.querySelectorAll(".text-small.color-fg-muted"),
        )
          .map(text)
          .filter((value) => /^(?:\d+(?:\.\d+)?[dhms]\s*)+$/.test(value));
        if (durations.length === 1)
          graphDurations.set(url.pathname, durations[0] ?? "");
      });
  }
  const links = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>(
      route.kind === "jobs" ? 'nav a[href*="/job/"]' : "a[href]",
    ),
  );
  const seen = new Set<string>();
  const entries: { item: Item; element: HTMLElement }[] = [];
  for (const link of links) {
    if (link.closest("[data-actions-enhanced]")) continue;
    const url = safeUrl(link.getAttribute("href") ?? "", location.origin);
    if (!url?.pathname.startsWith(prefix) || seen.has(url.pathname)) continue;
    const suffix = url.pathname.slice(prefix.length);
    const expected = route.kind === "runs" ? /^\d+\/?$/ : /^\d+\/job\/\d+\/?$/;
    if (!expected.test(suffix)) continue;
    if (
      route.kind === "jobs" &&
      !url.pathname.startsWith(
        `${location.pathname.match(/^\/[^/]+\/[^/]+\/actions\/runs\/\d+/)?.[0]}/job/`,
      )
    )
      continue;
    const element =
      route.kind === "runs" ? link.closest<HTMLElement>("li, .Box-row") : link;
    if (!element || !text(link)) continue;
    seen.add(url.pathname);
    const item = emptyItem(url);
    item.title =
      text(link.querySelector('[data-component="ActionList.Item.Label"]')) ||
      text(link);
    item.status = readStatus(element);
    if (route.kind === "jobs")
      item.duration = graphDurations.get(url.pathname) ?? "";
    if (route.kind === "runs") {
      const label = element.getAttribute("aria-label") ?? "";
      const metadata = label.match(/Run (\d+) of (.+?)\.(?:\s|$)/);
      item.number = metadata?.[1] ?? "";
      item.workflow = metadata?.[2] ?? "";
      item.branch = text(element.querySelector('a[href*="/tree/"]'));
      item.actor = text(
        Array.from(element.querySelectorAll("a[href]")).find((anchor) => {
          const href = anchor.getAttribute("href") ?? "";
          return /^\/[^/]+\/?$/.test(href) && text(anchor).length > 0;
        }),
      );
      item.timestamp =
        element
          .querySelector("relative-time, time")
          ?.getAttribute("datetime") ?? "";
      const duration = text(
        element.querySelector(".octicon-stopwatch")?.parentElement,
      );
      item.duration = /^(?:\d+(?:\.\d+)?[dhms]\s*)+$/.test(duration)
        ? duration
        : "";
    }
    entries.push({ item, element });
  }
  const first = entries[0];
  if (!first) return null;
  if (route.kind === "runs") {
    const nativeList = first.element.parentElement;
    if (
      !nativeList ||
      entries.some(({ element }) => element.parentElement !== nativeList)
    )
      return null;
    return {
      ...route,
      anchor: nativeList,
      nativeList,
      items: entries.map(({ item }) => item),
      targets: entries.map(({ item, element }) => ({ id: item.id, element })),
    };
  }
  const anchor = first.element.closest("nav");
  if (entries.some(({ element }) => element.closest("nav") !== anchor))
    return null;
  return anchor instanceof HTMLElement
    ? {
        ...route,
        anchor,
        nativeList: null,
        items: entries.map(({ item }) => item),
        targets: entries.map(({ item, element }) => {
          const row = element.closest("li");
          return {
            id: item.id,
            element:
              row &&
              Array.from(row.querySelectorAll('a[href*="/job/"]')).filter(
                (anchor) => !anchor.closest("[data-actions-enhanced]"),
              ).length === 1
                ? row
                : element,
          };
        }),
      }
    : null;
};

export const needsAttention = (status: Status) =>
  status === "failure" || status === "action_required";

const priority: Record<Status, number> = {
  failure: 0,
  action_required: 1,
  in_progress: 2,
  queued: 3,
  unknown: 4,
  cancelled: 5,
  skipped: 6,
  success: 7,
};

export const filterItems = (
  items: Item[],
  query: string,
  filter: "all" | "attention" | "active" | "failure" | "success",
  workflow: string,
  attentionFirst: boolean,
) => {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = items.filter((item) => {
    const haystack = [
      item.title,
      item.workflow,
      item.branch,
      item.actor,
      item.number,
      statusLabels[item.status],
    ]
      .join(" ")
      .toLowerCase();
    return (
      terms.every((term) => haystack.includes(term)) &&
      (!workflow || item.workflow === workflow) &&
      (filter === "all" ||
        (filter === "attention" && needsAttention(item.status)) ||
        (filter === "failure" && item.status === "failure") ||
        (filter === "active" &&
          ["in_progress", "queued"].includes(item.status)) ||
        (filter === "success" && item.status === "success"))
    );
  });
  return attentionFirst
    ? result.sort((a, b) => priority[a.status] - priority[b.status])
    : result;
};

export const filterNativeItems = (
  targets: Surface["targets"],
  visible: Set<string>,
) => {
  const hidden = targets
    .filter(({ id }) => !visible.has(id))
    .map(({ element }) => {
      const display = element.style.getPropertyValue("display");
      const priority = element.style.getPropertyPriority("display");
      element.style.setProperty("display", "none", "important");
      return { element, display, priority };
    });
  return () => {
    hidden.forEach(({ element, display, priority }) => {
      if (display) element.style.setProperty("display", display, priority);
      else element.style.removeProperty("display");
    });
  };
};
