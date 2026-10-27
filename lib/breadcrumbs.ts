import { selectedJobPath } from "./run-url";

export type Breadcrumb = {
  level: "actions" | "workflow" | "branch" | "commit" | "run" | "job";
  label: string;
  href: string;
};

export const readNavigationBreadcrumbs = (
  doc: Document,
  current: URL,
): Breadcrumb[] => {
  const crumbs = readBreadcrumbs(doc, current);
  const actions = current.pathname.match(
    /^(\/[^/]+\/[^/]+\/actions)\/runs\/\d+/,
  )?.[1];
  if (!actions || !crumbs.length) return [];
  return [
    { level: "actions", label: "Actions", href: actions },
    ...crumbs.map((crumb) => {
      if (crumb.level !== "branch") return crumb;
      const url = new URL(actions, current);
      url.searchParams.set("query", `branch:${crumb.label}`);
      return { ...crumb, href: `${url.pathname}${url.search}` };
    }),
  ];
};

const nativeText = (element: Element | null) => {
  if (!element || element.closest("[data-actions-enhanced]")) return "";
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    if (
      !node.parentElement?.closest(
        "[data-actions-enhanced], script, style, svg, [hidden]:not([data-ae-native-section]), [aria-hidden=true]",
      )
    )
      parts.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  return parts
    .join("")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const readBreadcrumbs = (doc: Document, current: URL): Breadcrumb[] => {
  const route = current.pathname.match(
    /^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/job\/\d+|\/attempts\/[1-9]\d*)?\/?$/,
  );
  if (!route || current.protocol !== "https:") return [];
  const repository = `/${route[1]}`;
  const run = `${repository}/actions/runs/${route[2]}`;
  const workflows = `${repository}/actions/workflows/`;
  const root = doc.querySelector("main") ?? doc;
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .filter((link) => !link.closest("[data-actions-enhanced]"))
    .flatMap((element) => {
      const href = element.getAttribute("href") ?? "";
      if (!href || /[\u0000-\u0020\u007f]/.test(href)) return [];
      try {
        const url = new URL(href, current);
        if (
          url.origin !== current.origin ||
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !url.pathname.startsWith(`${repository}/`)
        )
          return [];
        return [{ element, href, url }];
      } catch {
        return [];
      }
    });
  const result: Breadcrumb[] = [];
  const add = (
    level: Breadcrumb["level"],
    link: (typeof links)[number] | undefined,
    label = link ? nativeText(link.element) : "",
  ) => {
    if (link && label) result.push({ level, label, href: link.href });
  };
  add(
    "workflow",
    links.find(
      ({ element, url }) =>
        url.pathname.startsWith(workflows) &&
        /^[^/]+\/?$/.test(url.pathname.slice(workflows.length)) &&
        nativeText(element),
    ),
  );
  add(
    "branch",
    links.find(
      ({ element, url }) =>
        url.pathname.startsWith(`${repository}/tree/`) &&
        url.pathname.length > `${repository}/tree/`.length &&
        nativeText(element),
    ),
  );
  add(
    "commit",
    links.find(
      ({ element, url }) =>
        url.pathname.startsWith(`${repository}/commit/`) &&
        /^[a-f\d]{7,40}\/?$/i.test(
          url.pathname.slice(`${repository}/commit/`.length),
        ) &&
        nativeText(element),
    ),
  );
  if (!result.some(({ level }) => level === "commit")) {
    const selected = selectedJobPath(current);
    const jobId = selected.match(/\/job\/(\d+)$/)?.[1];
    const rawLogs = jobId
      ? links.find(
          ({ url }) =>
            url.pathname.startsWith(`${repository}/commit/`) &&
            new RegExp(`^[a-f\\d]{40}/checks/${jobId}/logs/?$`, "i").test(
              url.pathname.slice(`${repository}/commit/`.length),
            ),
        )
      : undefined;
    const sha = rawLogs?.url.pathname.split("/commit/")[1]?.split("/")[0];
    if (sha)
      result.push({
        level: "commit",
        label: sha.slice(0, 7),
        href: `${repository}/commit/${sha}`,
      });
  }
  const heading = Array.from(
    root.querySelectorAll(
      "h1.PageHeader-title, page-header h1, .page-header h1, .PageHeader h1, h1:has(.markdown-title)",
    ),
  ).find((element) => !element.closest("[data-actions-enhanced]"));
  add(
    "run",
    links.find(({ url }) => url.pathname.replace(/\/$/, "") === run),
    nativeText(heading ?? null),
  );
  const selected = selectedJobPath(current);
  const jobs = links.filter(
    ({ url }) => url.pathname.replace(/\/$/, "") === selected,
  );
  const job = jobs.find(({ element }) => element.closest("nav")) ?? jobs[0];
  const jobLabel = job?.element.querySelector(
    '[data-component="ActionList.Item.Label"], [data-target="streaming-graph-job.name"], strong',
  );
  add("job", job, nativeText(jobLabel ?? job?.element ?? null));
  return result;
};
