// @vitest-environment-options {"url":"https://github.com/"}
import { afterEach, expect, it, vi } from "vitest";
import { installJobDetails, readAnnotationCount } from "../lib/job-details";
import { jobHref } from "../lib/run-url";

const run = "/acme/widget/actions/runs/102";
let details: ReturnType<typeof installJobDetails> | undefined;
const markup = (
  annotations = true,
) => `<section aria-label="Check run summary"><div>
  ${annotations ? '<div><div role="region" aria-label="Annotations"><job-annotations><button data-target="job-annotations.openButton">Open annotations</button><annotation-message>Real native notice</annotation-message></job-annotations></div></div>' : ""}
  <div class="CheckRun js-check-steps"><button id="native-step">Set up job</button><pre>Real native logs</pre></div>
  </div></section>`;
const setup = (annotation = true, search = "") => {
  history.replaceState({}, "", `${run}/job/11${search}`);
  document.body.innerHTML = `<page-header><div class="PageHeader-titleBar"></div></page-header><split-page-layout data-ae-workspace><div class="PageLayout-content">${markup(annotation)}</div></split-page-layout>`;
  details = installJobDetails(document, window);
  details.refresh();
};
const tab = (name: string) => document.getElementById(`ae-job-${name}-tab`);
afterEach(() => {
  details?.remove();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("opens and focuses the requested native step without replacing its logs", () => {
  setup(true, "?ae_view=table&ae_tab=details&ae_step=2");
  const logs = document.querySelector(".CheckRun");
  const step = document.createElement("details");
  step.className = "js-checks-log-details";
  step.dataset.stepNumber = "2";
  step.innerHTML = "<summary>Build</summary><pre>Native output</pre>";
  logs?.append(step);
  const summary = step.querySelector("summary");
  const clicked = vi.fn();
  summary?.addEventListener("click", clicked);
  expect(details?.revealStep()).toBe(true);
  expect(step.open).toBe(true);
  expect(clicked).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(summary);
  expect(new URL(location.href).searchParams.get("ae_view")).toBe("table");
  expect(new URL(location.href).searchParams.has("ae_tab")).toBe(false);
  expect(document.querySelector(".CheckRun")).toBe(logs);
});

it("defaults to native logs and switches annotations in place without moving or copying either renderer", () => {
  setup();
  const nativeLogs = document.querySelector(".CheckRun");
  const annotation = document.querySelector("annotation-message");
  const logParent = nativeLogs?.parentElement;
  const annotationParent = annotation?.parentElement;
  expect(tab("log")?.getAttribute("aria-selected")).toBe("true");
  tab("annotations")?.click();
  expect(tab("annotations")?.getAttribute("aria-selected")).toBe("true");
  expect(
    document
      .querySelector(".PageLayout-content")
      ?.getAttribute("data-ae-detail-tab"),
  ).toBe("annotations");
  expect(new URL(location.href).searchParams.get("ae_tab")).toBe("annotations");
  expect(document.querySelector(".CheckRun")).toBe(nativeLogs);
  expect(nativeLogs?.parentElement).toBe(logParent);
  expect(annotation?.parentElement).toBe(annotationParent);
  tab("log")?.click();
  expect(new URL(location.href).searchParams.has("ae_tab")).toBe(false);
  expect(document.getElementById("ae-job-annotations-empty")?.hidden).toBe(
    true,
  );
});

it("supports roving keyboard focus and actual native annotation expansion", () => {
  setup();
  const open = document.querySelector("job-annotations button");
  const click = vi.fn();
  open?.addEventListener("click", click);
  tab("log")?.focus();
  tab("log")?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  expect(document.activeElement).toBe(tab("annotations"));
  expect(tab("log")?.tabIndex).toBe(-1);
  expect(click).toHaveBeenCalledOnce();
  tab("annotations")?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
  );
  expect(document.activeElement).toBe(tab("log"));
});

it("hides empty annotations and returns to logs on native job changes", () => {
  setup(true, "?ae_tab=annotations&ae_view=table");
  const url = new URL(jobHref(`${run}/job/12`, new URL(location.href)));
  expect(url.searchParams.get("ae_tab")).toBe("annotations");
  expect(url.searchParams.get("ae_view")).toBe("table");
  history.replaceState({}, "", url);
  const replacement = document.createElement("main");
  replacement.className = "PageLayout-content";
  replacement.innerHTML = markup(false);
  document.querySelector(".PageLayout-content")?.replaceWith(replacement);
  details?.refresh();
  expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(1);
  expect(tab("annotations")?.hidden).toBe(true);
  expect(tab("log")?.getAttribute("aria-selected")).toBe("true");
  expect(document.getElementById("ae-job-annotations-empty")?.hidden).toBe(
    true,
  );
  expect(replacement.getAttribute("data-ae-detail-tab")).toBe("log");
  expect(new URL(location.href).searchParams.has("ae_tab")).toBe(false);
  expect(
    document
      .querySelector('[data-ae-detail-panel="log"]')
      ?.getAttribute("role"),
  ).toBe("tabpanel");
});

it("skips empty annotations in keyboard navigation and restores the tab on live updates", () => {
  setup(false);
  expect(tab("annotations")?.hidden).toBe(true);
  tab("log")?.focus();
  tab("log")?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  expect(document.activeElement).toBe(tab("details"));
  const root = document.querySelector(
    'section[aria-label="Check run summary"]',
  );
  root?.insertAdjacentHTML(
    "afterbegin",
    '<div role="region" aria-label="Annotations"><h2>Annotations</h2><div>No annotations</div></div>',
  );
  details?.refresh();
  expect(tab("annotations")?.hidden).toBe(true);
  document
    .querySelector('[aria-label="Annotations"] h2')
    ?.nextElementSibling?.replaceChildren("1 notice");
  details?.refresh();
  expect(tab("annotations")?.hidden).toBe(false);
});

it("does not add empty imitation tabs on unsupported or summary markup and restores original attributes", () => {
  setup();
  const log = document.querySelector(".CheckRun");
  details?.remove();
  expect(log?.hasAttribute("data-ae-detail-panel")).toBe(false);
  expect(log?.hasAttribute("role")).toBe(false);
  expect(log?.hasAttribute("tabindex")).toBe(false);
  expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(0);
  document.querySelector(".PageLayout-content")?.replaceChildren();
  details = installJobDetails(document, window);
  details.refresh();
  expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(0);
});

it("uses the native summary count for the Primer CounterLabel and refreshes it on live updates", () => {
  setup();
  const annotations = document.querySelector<HTMLElement>(
    '[role="region"][aria-label="Annotations"]',
  );
  if (!annotations) throw new Error("Missing annotations.");
  const heading = document.createElement("h2");
  heading.textContent = "Annotations";
  const summary = document.createElement("div");
  summary.textContent = "2 errors and 3 warnings, 1 notice";
  annotations.prepend(heading, summary);
  expect(readAnnotationCount(annotations)).toBe(6);
  details?.refresh();
  const counter = document.querySelector(".ae-annotation-counts");
  expect(counter?.querySelector('[aria-label="2 errors"]')).not.toBeNull();
  expect(counter?.querySelector('[aria-label="3 warnings"]')).not.toBeNull();
  expect(counter?.querySelector('[aria-label="1 notice"]')).not.toBeNull();
  annotations
    .querySelector("h2")
    ?.nextElementSibling?.replaceChildren("1 notice");
  details?.refresh();
  expect(counter?.textContent?.trim()).toBe("1");
  expect(counter?.querySelectorAll(".ae-annotation-count")).toHaveLength(1);
  expect(tab("annotations")?.textContent).not.toContain("Annotations");
  expect(counter?.querySelector(".CounterLabel")).toBeNull();
  expect(readAnnotationCount(null)).toBe(0);
  annotations
    .querySelector("h2")
    ?.nextElementSibling?.replaceChildren("1,234 annotations");
  expect(readAnnotationCount(annotations)).toBe(1234);
});

it("keeps selected-job context across detail tabs without adopting workflow summaries", () => {
  setup();
  const root = document.querySelector<HTMLElement>(
    'section[aria-label="Check run summary"]',
  );
  if (!root) throw new Error("Missing check summary.");
  const summary = document.createElement("job-summary");
  summary.innerHTML =
    "<h3>Test results</h3><button>Native summary menu</button>";
  root.append(summary);
  const parent = summary.parentElement;
  details?.refresh();
  const context = document.querySelector(
    '[data-actions-enhanced="job-header-facts"]',
  );
  tab("details")?.click();
  expect(tab("details")?.getAttribute("aria-selected")).toBe("true");
  expect(new URL(location.href).searchParams.get("ae_tab")).toBe("details");
  expect(tab("details")?.getAttribute("aria-controls")).toBe(
    "ae-job-details-panel",
  );
  expect(document.getElementById("ae-job-details-panel")?.hidden).toBe(false);
  expect(summary.parentElement).toBe(parent);
  expect(document.querySelector("job-summary")).toBe(summary);
  tab("annotations")?.click();
  expect(
    document.querySelector('[data-actions-enhanced="job-header-facts"]'),
  ).toBe(context);
  expect(document.getElementById("ae-job-details-panel")?.hidden).toBe(true);
  details?.remove();
  expect(summary.hasAttribute("data-ae-detail-panel")).toBe(false);
  expect(summary.hasAttribute("role")).toBe(false);
  expect(
    document.querySelector('[data-actions-enhanced="job-header-facts"]'),
  ).toBeNull();
});

it("restores Details via URL and includes it in roving tab keyboard navigation", () => {
  setup(false, "?ae_tab=details");
  expect(tab("details")?.getAttribute("aria-selected")).toBe("true");
  tab("log")?.focus();
  tab("log")?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "End", bubbles: true }),
  );
  expect(document.activeElement).toBe(tab("details"));
  tab("details")?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  expect(document.activeElement).toBe(tab("log"));
});

it("preserves the layout start/end controls around all three job tabs", () => {
  setup();
  details?.remove();
  const start = document.createElement("button");
  start.textContent = "Close job pane";
  const end = document.createElement("button");
  end.textContent = "Job layout";
  const click = vi.fn();
  end.addEventListener("click", click);
  details = installJobDetails(document, window, { start, end });
  details.refresh();
  const bar = document.querySelector(".ae-job-detail-tabs");
  expect(bar?.firstElementChild).toBe(start);
  expect(bar?.lastElementChild).toBe(end);
  expect(bar?.querySelectorAll('[role="tab"]')).toHaveLength(3);
  tab("details")?.click();
  end.click();
  expect(click).toHaveBeenCalledOnce();
  expect(bar?.lastElementChild).toBe(end);
});
