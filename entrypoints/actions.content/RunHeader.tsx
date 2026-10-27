import { readNavigationBreadcrumbs } from "../../lib/breadcrumbs";
import { readStatus, statusLabels } from "../../lib/github";
import { readJobContext } from "../../lib/job-inspector";
import { jobHref } from "../../lib/run-url";
import "./run-header.css";

export const readRunHeader = (doc: Document, current: URL) => {
  const header = doc.querySelector("page-header:has(.PageHeader-title)");
  if (!header) return null;
  const crumbs = readNavigationBreadcrumbs(doc, current).filter(
    (crumb) => crumb.level !== "run",
  );
  const title = header.querySelector(".PageHeader-title");
  const number = title?.textContent?.trim().match(/#(\d+)\s*$/)?.[1];
  const run = current.pathname.match(
    /^\/[^/]+\/[^/]+\/actions\/runs\/\d+/,
  )?.[0];
  const job = crumbs.find((crumb) => crumb.level === "job");
  const links = crumbs.filter((crumb) => crumb.level !== "job");
  if (number && run)
    links.push({ level: "run", label: `#${number}`, href: run });
  if (job) links.push(job);
  const statusElement = header.querySelector(".actions-workflow-runs-status");
  const status = statusElement ? readStatus(statusElement) : "unknown";
  const usage = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ).find((link) => {
    if (link.closest("[data-actions-enhanced]")) return false;
    try {
      return (
        new URL(link.href, current).pathname === `${run}/usage` &&
        /^(?:\d+(?:\.\d+)?[dhms]\s*)+$/.test(link.textContent?.trim() ?? "")
      );
    } catch {
      return false;
    }
  });
  const durationText = usage?.textContent?.trim() ?? "";
  const duration = /^(?:\d+(?:\.\d+)?[dhms]\s*)+$/.test(durationText)
    ? durationText
    : "";
  const jobRoot = doc.querySelector<HTMLElement>(
    'section[aria-label="Check run summary"]:not([hidden])',
  );
  const jobContext = jobRoot ? readJobContext(doc, current, jobRoot) : null;
  return {
    links,
    status:
      jobContext && jobContext.status !== "unknown"
        ? jobContext.status
        : status,
    duration: jobContext ? (jobContext.duration ?? "") : duration,
    title: title?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  };
};

const icons = {
  workflow:
    "M3 1a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 4v6a2 2 0 0 0 2 2h3m0-4v6m4-13v5a2 2 0 0 1-2 2H8",
  branch:
    "M4 5v8m0-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm8-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v2a3 3 0 0 1-3 3H4",
  commit: "M1 8h4m6 0h4M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
};

export const RunHeader = () => {
  const current = new URL(location.href);
  const data = readRunHeader(document, current);
  if (!data) return null;
  const commit = data.links.find(({ level }) => level === "commit");
  const commitUrl = commit ? new URL(commit.href, current) : null;
  const hovercardUrl = commitUrl
    ? `${commitUrl.pathname.replace(/\/$/, "")}/hovercard`
    : undefined;
  return (
    <div className="ae-run-header">
      <nav aria-label="Workflow run breadcrumbs">
        <ol className="ae-run-header-trail">
          {data.links.map(({ level, label, href }, index) => (
            <li key={level}>
              {level in icons && (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d={icons[level as keyof typeof icons]} />
                </svg>
              )}
              <a
                className="Link--primary"
                href={level === "job" ? jobHref(href, current) : href}
                aria-current={
                  index === data.links.length - 1 ? "page" : undefined
                }
                data-hovercard-type={
                  hovercardUrl && (level === "branch" || level === "commit")
                    ? "commit"
                    : undefined
                }
                data-hovercard-url={
                  level === "branch" || level === "commit"
                    ? hovercardUrl
                    : undefined
                }
                title={
                  hovercardUrl && (level === "branch" || level === "commit")
                    ? undefined
                    : level === "run"
                      ? data.title
                      : label
                }
              >
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div
        className={`ae-run-header-status ae-status-${data.status}`}
        role="status"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="currentColor" />
          <path
            d={
              data.status === "success"
                ? "m7 12 3 3 7-7"
                : data.status === "failure"
                  ? "m8 8 8 8m0-8-8 8"
                  : "M12 6v6l4 2"
            }
            fill="none"
            stroke="var(--bgColor-default, white)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>
          {statusLabels[data.status]}
          {data.duration && ` in ${data.duration}`}
        </span>
      </div>
    </div>
  );
};
