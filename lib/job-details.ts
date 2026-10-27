import { annotationKinds, readAnnotationCounts } from "./annotation-counts";
import { createJobInspector } from "./job-inspector";

type DetailTab = "log" | "annotations" | "details";

const readTab = (url: URL): DetailTab =>
  url.searchParams.get("ae_tab") === "annotations"
    ? "annotations"
    : url.searchParams.get("ae_tab") === "details"
      ? "details"
      : "log";

export const readAnnotationCount = (
  annotations: HTMLElement | null,
): number | null => {
  if (!annotations) return 0;
  const heading = Array.from(annotations.querySelectorAll("h2, h3, h4")).find(
    (element) => element.textContent?.trim() === "Annotations",
  );
  const summary = heading?.nextElementSibling?.textContent ?? "";
  const counts = Array.from(
    summary.matchAll(
      /\b(\d[\d,]*)\s+(?:errors?|warnings?|notices?|annotations?)\b/gi,
    ),
  );
  if (counts.length)
    return counts.reduce(
      (total, match) => total + Number(match[1]?.replaceAll(",", "")),
      0,
    );
  if (/\bno annotations\b/i.test(summary)) return 0;
  const rendered = annotations.querySelectorAll("annotation-message").length;
  return rendered || null;
};

const panelBranch = (
  element: HTMLElement,
  others: HTMLElement[],
  root: HTMLElement,
) => {
  let branch = element;
  while (
    branch.parentElement &&
    branch.parentElement !== root &&
    !others.some((other) => branch.parentElement?.contains(other))
  )
    branch = branch.parentElement;
  return branch;
};

export const installJobDetails = (
  doc: Document,
  win: Window,
  controls?: { start: HTMLElement; end: HTMLElement },
) => {
  let content: HTMLElement | null = null;
  let logs: HTMLElement | null = null;
  let annotations: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let panels: { element: HTMLElement; restore: () => void }[] = [];
  const inspector = createJobInspector(doc, win, () => select("log"));
  const bar = doc.createElement("div");
  bar.className = "ae-job-detail-tabs UnderlineNav";
  bar.setAttribute("data-actions-enhanced", "job-details");
  const body = doc.createElement("div");
  body.className = "UnderlineNav-body";
  body.setAttribute("role", "tablist");
  body.setAttribute("aria-label", "Job details");
  const counter = doc.createElement("span");
  counter.className = "ae-annotation-counts";
  const empty = doc.createElement("p");
  empty.className = "ae-job-detail-empty color-fg-muted";
  empty.textContent = "No annotations for this job.";
  empty.setAttribute("data-actions-enhanced", "job-details-empty");
  empty.setAttribute("role", "tabpanel");
  empty.id = "ae-job-annotations-empty";
  empty.setAttribute("aria-labelledby", "ae-job-annotations-tab");
  empty.tabIndex = 0;
  const buttons = (["log", "annotations", "details"] as const).map((tab) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.id = `ae-job-${tab}-tab`;
    button.className = "UnderlineNav-item";
    button.setAttribute("role", "tab");
    button.textContent =
      tab === "log" ? "Log" : tab === "annotations" ? "" : "Details";
    if (tab === "annotations") {
      button.setAttribute("aria-label", "Annotations");
      button.append(counter);
    }
    button.addEventListener("click", () => select(tab));
    body.append(button);
    return { tab, button };
  });
  bar.append(...(controls ? [controls.start, controls.end] : []));
  const restore = () => {
    panels.forEach((panel) => panel.restore());
    panels = [];
  };
  const markPanel = (element: HTMLElement, tab: DetailTab) => {
    const names = [
      "id",
      "role",
      "aria-labelledby",
      "tabindex",
      "data-ae-detail-panel",
    ];
    const original = names.map(
      (name) => [name, element.getAttribute(name)] as const,
    );
    if (!element.id) element.id = `ae-job-${tab}-panel`;
    if (!element.hasAttribute("role")) element.setAttribute("role", "tabpanel");
    element.setAttribute("aria-labelledby", `ae-job-${tab}-tab`);
    element.tabIndex = 0;
    element.setAttribute("data-ae-detail-panel", tab);
    panels.push({
      element,
      restore: () => {
        original.forEach(([name, value]) => {
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        });
      },
    });
  };
  const update = () => {
    if (!content || !logs || !root) return;
    inspector.refresh(root);
    const url = new URL(win.location.href);
    let tab = readTab(url);
    const count = readAnnotationCount(annotations);
    if (tab === "annotations" && count === 0) {
      tab = "log";
      url.searchParams.delete("ae_tab");
      win.history.replaceState(win.history.state, "", url);
    }
    const counts = readAnnotationCounts(annotations);
    const value = annotationKinds
      .filter(({ kind }) => counts[kind] > 0)
      .map(
        ({ kind, label, icon, color, path }) =>
          `<span class="ae-annotation-count ${color}" aria-label="${counts[kind]} ${counts[kind] === 1 ? kind : label}"><svg class="octicon octicon-${icon}" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg> ${counts[kind]}</span>`,
      )
      .join("");
    const markup =
      value ||
      `<span class="ae-annotation-count color-fg-muted" aria-label="${count ?? "Unknown"} annotations"><svg class="octicon octicon-info" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${annotationKinds[2].path}"/></svg> ${count ?? "?"}</span>`;
    if (counter.dataset.counts !== markup) {
      counter.innerHTML = markup;
      counter.dataset.counts = markup;
    }
    content.setAttribute("data-ae-detail-tab", tab);
    buttons.forEach(({ tab: name, button }) => {
      button.hidden = name === "annotations" && count === 0;
      const active = name === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      const target = panels.find(
        (panel) => panel.element.getAttribute("data-ae-detail-panel") === name,
      )?.element;
      button.setAttribute(
        "aria-controls",
        name === "details" ? inspector.panel.id : (target?.id ?? empty.id),
      );
    });
    empty.hidden = tab !== "annotations" || !!annotations;
    inspector.panel.hidden = tab !== "details";
  };
  const refresh = () => {
    const next = doc.querySelector<HTMLElement>(
      "[data-ae-workspace] .PageLayout-content",
    );
    const nextRoot = next?.querySelector<HTMLElement>(
      'section[aria-label="Check run summary"]:not([hidden])',
    );
    const nextLogs =
      nextRoot?.querySelector<HTMLElement>(".js-check-steps, .CheckRun") ??
      null;
    const nextAnnotations =
      nextRoot?.querySelector<HTMLElement>(
        '[role="region"][aria-label="Annotations"]',
      ) ?? null;
    if (
      content !== next ||
      logs !== nextLogs ||
      annotations !== nextAnnotations ||
      root !== nextRoot
    ) {
      restore();
      content?.removeAttribute("data-ae-detail-tab");
      bar.remove();
      empty.remove();
      inspector.remove();
      content = next;
      root = nextRoot ?? null;
      logs = nextLogs;
      annotations = nextAnnotations;
      if (content && root && logs) {
        markPanel(
          panelBranch(logs, annotations ? [annotations] : [], root),
          "log",
        );
        if (annotations)
          markPanel(panelBranch(annotations, [logs], root), "annotations");
        bar.insertBefore(body, controls?.end ?? null);
        content.append(empty, inspector.panel);
      } else body.remove();
      if (content && (logs || controls)) content.prepend(bar);
    }
    update();
  };
  const select = (tab: DetailTab) => {
    const url = new URL(win.location.href);
    if (tab !== "log") url.searchParams.set("ae_tab", tab);
    else url.searchParams.delete("ae_tab");
    win.history.replaceState(win.history.state, "", url);
    update();
    if (content) content.scrollTop = 0;
    if (tab === "annotations")
      annotations
        ?.querySelector<HTMLButtonElement>(
          'button[data-target="job-annotations.openButton"]:not([hidden])',
        )
        ?.click();
  };
  const revealStep = () => {
    const number = new URL(win.location.href).searchParams.get("ae_step");
    if (!number || !/^[1-9]\d*$/.test(number) || !root) return false;
    const step = Array.from(
      root.querySelectorAll<HTMLDetailsElement>(
        ".js-checks-log-details[data-step-number]",
      ),
    ).find((element) => element.dataset.stepNumber === number);
    if (!step) return false;
    select("log");
    const summary = step.querySelector<HTMLElement>("summary");
    if (!step.open) summary?.click();
    step.scrollIntoView?.({ block: "nearest" });
    summary?.focus({ preventScroll: true });
    return true;
  };
  const keydown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const visibleButtons = buttons.filter(({ button }) => !button.hidden);
    const index = visibleButtons.findIndex(
      ({ button }) => button === doc.activeElement,
    );
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? visibleButtons.length - 1
          : (index +
              (event.key === "ArrowRight" ? 1 : -1) +
              visibleButtons.length) %
            visibleButtons.length;
    const target = visibleButtons[next];
    if (!target) return;
    target.button.focus();
    select(target.tab);
  };
  bar.addEventListener("keydown", keydown);
  win.addEventListener("popstate", refresh);
  doc.addEventListener("turbo:load", refresh);
  return {
    refresh,
    revealStep,
    remove: () => {
      restore();
      content?.removeAttribute("data-ae-detail-tab");
      bar.remove();
      empty.remove();
      inspector.remove();
      bar.removeEventListener("keydown", keydown);
      win.removeEventListener("popstate", refresh);
      doc.removeEventListener("turbo:load", refresh);
    },
  };
};
