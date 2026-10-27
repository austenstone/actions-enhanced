import { readStatus, readSurface, type Status } from "./github";
import { readTimingContext } from "./job-timing";
import { selectedJobPath } from "./run-url";

export type JobContext = {
  name: string;
  status: Status;
  duration: string | null;
  runner: string | null;
  attempt: number | null;
  attemptError: string | null;
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const nativeMetadata = (root: HTMLElement, label: string) => {
  const term = Array.from(root.querySelectorAll("dt")).find(
    (element) =>
      !element.closest(".js-check-steps, .CheckRun, [data-actions-enhanced]") &&
      text(element).replace(/:$/, "").toLowerCase() === label,
  );
  return term?.nextElementSibling?.matches("dd")
    ? text(term.nextElementSibling) || null
    : null;
};

export const readJobContext = (
  doc: Document,
  url: URL,
  root: HTMLElement,
): JobContext => {
  const selectedPath = selectedJobPath(url);
  const selected = readSurface(doc, url)?.items.find(
    (item) => item.id.replace(/\/$/, "") === selectedPath,
  );
  const nativeHeader = root.querySelector(
    ".js-checks-log-toolbar .CheckRun-log-title > span.js-updatable-content",
  );
  const nativeName = text(
    root.querySelector("#check-step-header-title .two-line-wrapping"),
  );
  const nativeDuration = text(nativeHeader)
    .match(/\bin\s+((?:\d+(?:\.\d+)?[dhms]\s*)+)$/)?.[1]
    ?.trim();
  const headerStatus = nativeHeader ? readStatus(nativeHeader) : "unknown";
  let attempt: number | null = null;
  let attemptError: string | null = null;
  try {
    attempt = readTimingContext(url, doc).attempt;
  } catch (error) {
    attemptError = `Attempt unavailable: ${error instanceof Error ? error.message : "Native attempt context could not be read."}`;
  }
  const duration =
    nativeDuration || selected?.duration || nativeMetadata(root, "duration");
  return {
    name: nativeName || selected?.title || "Selected job",
    status:
      selected?.status && selected.status !== "unknown"
        ? selected.status
        : headerStatus,
    duration: duration ?? null,
    runner:
      nativeMetadata(root, "runner name") ?? nativeMetadata(root, "runner"),
    attempt,
    attemptError,
  };
};

export const createJobInspector = (
  doc: Document,
  win: Window,
  showLogs: () => void,
) => {
  const rowDurations = new Map<HTMLAnchorElement, HTMLSpanElement>();
  const header = doc.createElement("div");
  header.className = "ae-job-header-facts text-small color-fg-muted";
  header.setAttribute("data-actions-enhanced", "job-header-facts");
  header.setAttribute("role", "group");
  header.setAttribute("aria-label", "Selected job details");

  const panel = doc.createElement("section");
  panel.className = "ae-job-inspector-details";
  panel.id = "ae-job-details-panel";
  panel.setAttribute("data-actions-enhanced", "job-inspector");
  panel.setAttribute("data-ae-detail-panel", "details");
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "ae-job-details-tab");
  panel.tabIndex = 0;
  const summaryHeading = doc.createElement("h3");
  summaryHeading.className = "f4";
  summaryHeading.textContent = "Job details";
  const description = doc.createElement("p");
  description.className = "color-fg-muted";
  description.textContent =
    "Details reflect this page's native GitHub data. Unknown values are not estimated.";
  const setup = doc.createElement("button");
  setup.type = "button";
  setup.className = "btn btn-sm";
  setup.textContent = "View native job setup";
  let setupControl: HTMLElement | null = null;
  setup.addEventListener("click", () => {
    showLogs();
    if (
      setupControl?.getAttribute("aria-expanded") === "false" ||
      setupControl?.matches("summary:not(details[open] > summary)")
    )
      setupControl.click();
    setupControl?.scrollIntoView?.({ block: "nearest" });
    setupControl?.focus();
  });
  const setupNote = doc.createElement("p");
  setupNote.className = "color-fg-muted";
  const identity = doc.createElement("p");
  identity.className = "text-mono";
  const attemptError = doc.createElement("p");
  attemptError.className = "color-fg-attention";
  attemptError.setAttribute("role", "status");
  panel.append(
    summaryHeading,
    identity,
    description,
    attemptError,
    setup,
    setupNote,
  );

  const refresh = (root: HTMLElement) => {
    const url = new URL(win.location.href);
    const context = readJobContext(doc, url, root);
    const surface = readSurface(doc, url);
    const currentLinks = new Set<HTMLAnchorElement>();
    for (const item of surface?.kind === "jobs" ? surface.items : []) {
      const link = Array.from(
        surface?.anchor.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/job/"]',
        ) ?? [],
      ).find((anchor) => new URL(anchor.href, url).pathname === item.id);
      if (!link) continue;
      const duration =
        item.id === selectedJobPath(url)
          ? context.duration || item.duration
          : item.duration;
      if (!duration) continue;
      currentLinks.add(link);
      let label = rowDurations.get(link);
      if (!label) {
        label = doc.createElement("span");
        label.className = "ae-job-row-duration text-small color-fg-muted";
        label.setAttribute("data-actions-enhanced", "job-duration");
        link.append(label);
        rowDurations.set(link, label);
      }
      if (label.textContent !== duration) label.textContent = duration;
    }
    for (const [link, label] of rowDurations) {
      if (!currentLinks.has(link)) {
        label.remove();
        rowDurations.delete(link);
      }
    }
    const jobId = selectedJobPath(url).match(/\/job\/(\d+)$/)?.[1];
    const identityText = jobId ? `Job #${jobId}` : "Job ID unknown";
    if (identity.textContent !== identityText)
      identity.textContent = identityText;
    attemptError.hidden = !context.attemptError;
    const attemptMessage = context.attemptError ?? "";
    if (attemptError.textContent !== attemptMessage)
      attemptError.textContent = attemptMessage;
    const values = [
      ["Runner", context.runner],
      [
        "Attempt",
        context.attempt !== null && context.attempt > 2
          ? String(context.attempt)
          : null,
      ],
    ].filter((entry) => entry[1] !== null);
    const fingerprint = JSON.stringify(values);
    if (header.dataset.values !== fingerprint) {
      header.dataset.values = fingerprint;
      header.replaceChildren(
        ...values.map(([label, value]) => {
          const fact = doc.createElement("span");
          fact.setAttribute("aria-label", `${label}: ${value}`);
          fact.title = `${label}: ${value}`;
          fact.textContent =
            label === "Runner" || label === "Attempt"
              ? `${label} ${value}`
              : (value ?? "");
          return fact;
        }),
      );
    }
    const titleBar = doc.querySelector<HTMLElement>(
      "page-header .PageHeader-titleBar",
    );
    if (titleBar && header.parentElement !== titleBar) {
      const actions = Array.from(titleBar.children).find((element) =>
        element.matches(".PageHeader-actions, .ae-run-detail-actions"),
      );
      titleBar.insertBefore(header, actions ?? null);
    } else if (!titleBar) header.remove();
    header.hidden = values.length === 0;
    setupControl =
      Array.from(
        root.querySelectorAll<HTMLElement>(
          ".js-check-steps button, .js-check-steps summary, .CheckRun button, .CheckRun summary",
        ),
      ).find(
        (element) =>
          !element.closest("[data-actions-enhanced]") &&
          text(element.querySelector(".CheckStep-titleName") ?? element) ===
            "Set up job",
      ) ?? null;
    setup.hidden = !setupControl;
    setupNote.hidden = !!setupControl;
    const setupMessage = "Job setup details are not loaded on this page.";
    if (setupNote.textContent !== setupMessage)
      setupNote.textContent = setupMessage;
  };
  return {
    header,
    panel,
    refresh,
    remove: () => {
      rowDurations.forEach((label) => label.remove());
      rowDurations.clear();
      header.remove();
      panel.remove();
      setupControl = null;
    },
  };
};
