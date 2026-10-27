// @vitest-environment-options {"url":"https://github.com/"}
import { afterEach, expect, it, vi } from "vitest";
import { createJobInspector, readJobContext } from "../lib/job-inspector";

const run = "/acme/widget/actions/runs/102";
const setup = (extra = "") => {
  history.replaceState({}, "", `${run}/job/11`);
  document.body.innerHTML = `
    <page-header><div class="PageHeader-titleBar"><div class="PageHeader-titleWrap">Native breadcrumbs</div><div class="PageHeader-actions"><button>Native actions</button></div></div></page-header>
    <nav aria-label="Workflow run"><a href="${run}/job/11">
      <svg class="octicon octicon-check-circle-fill"></svg>
      <span data-component="ActionList.Item.Label">test linux</span>
    </a><a href="${run}/job/12"><span>other job</span></a></nav>
    <streaming-graph-job><a href="${run}/job/11"><span class="text-small color-fg-muted">1m 12s</span></a></streaming-graph-job>
    <section aria-label="Check run summary">${extra}</section>`;
  const root = document.querySelector<HTMLElement>("section");
  if (!root) throw new Error("Missing native job root.");
  return root;
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("shows execution time beside the native job without duplicating context facts", () => {
  const root = setup(
    '<div class="js-checks-log-toolbar"><div class="CheckRun-log-title"><span class="js-updatable-content">passed in 18s</span></div></div>',
  );
  const link = document.querySelector<HTMLAnchorElement>("nav a");
  const click = vi.fn();
  link?.addEventListener("click", click);
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  inspector.refresh(root);
  expect(link?.querySelectorAll(".ae-job-row-duration")).toHaveLength(1);
  expect(link?.querySelector(".ae-job-row-duration")?.textContent).toBe("18s");
  expect(inspector.header.textContent).not.toContain("18s");
  expect(document.querySelector(".ae-job-context-facts")).toBeNull();
  link?.dispatchEvent(new MouseEvent("click"));
  expect(click).toHaveBeenCalledOnce();
  inspector.remove();
  expect(link?.querySelector(".ae-job-row-duration")).toBeNull();
});

it("reads selected job name, status, execution duration, native runner, and rendered attempt", () => {
  const root = setup(
    `<dl><dt>Runner name:</dt><dd>GitHub Actions 14</dd></dl>
    <include-fragment src="${run}/navigation_partial?attempt=2"></include-fragment>`,
  );
  expect(readJobContext(document, new URL(location.href), root)).toEqual({
    name: "test linux",
    status: "success",
    duration: "1m 12s",
    runner: "GitHub Actions 14",
    attempt: 2,
    attemptError: null,
  });
});

it("does not scrape runner/environment data from log payloads or infer missing durations and attempts", () => {
  const root = setup(
    '<div class="js-check-steps"><dl><dt>Runner name:</dt><dd>not metadata</dd></dl><pre>SECRET=value</pre></div>',
  );
  document.querySelector("streaming-graph-job")?.remove();
  expect(readJobContext(document, new URL(location.href), root)).toMatchObject({
    duration: null,
    runner: null,
    attempt: null,
  });
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  expect(inspector.header.textContent).not.toContain("Unknown");
  expect(inspector.header.textContent).not.toContain("SECRET");
  expect(inspector.panel.textContent).not.toContain("SECRET");
  expect(inspector.panel.querySelector("button")?.hidden).toBe(true);
  inspector.remove();
});

it("fails closed for conflicting attempt markers", () => {
  const root = setup(
    `<include-fragment src="${run}/navigation_partial?attempt=2"></include-fragment>
    <include-fragment src="${run}/navigation_partial?attempt=3"></include-fragment>`,
  );
  expect(
    readJobContext(document, new URL(location.href), root).attempt,
  ).toBeNull();
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  const warning = inspector.panel.querySelector<HTMLElement>('[role="status"]');
  expect(warning?.hidden).toBe(false);
  expect(warning?.textContent).toContain("conflicting run attempts");
  root.querySelector("include-fragment")?.remove();
  inspector.refresh(root);
  expect(warning?.hidden).toBe(true);
  expect(warning?.textContent).toBe("");
  inspector.remove();
});

it.each(["run-summary", "annotations", "artifacts"])(
  "keeps selected job identity and facts when the left %s tab uses ae_job",
  (view) => {
    const root = setup();
    history.replaceState({}, "", `${run}?ae_view=${view}&ae_job=11&attempt=2`);
    expect(
      readJobContext(document, new URL(location.href), root),
    ).toMatchObject({
      name: "test linux",
      status: "success",
      duration: "1m 12s",
      attempt: 2,
      attemptError: null,
    });
    const inspector = createJobInspector(document, window, vi.fn());
    inspector.refresh(root);
    expect(inspector.panel.textContent).toContain("Job #11");
    expect(inspector.header.textContent).not.toContain("Passed");
    expect(inspector.header.textContent).not.toContain("test linux");
    inspector.remove();
  },
);

it("uses the verified native log header and setup title without reading payloads or attributes", () => {
  const root = setup(
    `<div class="js-checks-log-toolbar">
      <div id="check-step-header-title"><span class="two-line-wrapping">test matrix (linux, 22)</span></div>
      <div class="CheckRun-log-title"><span class="js-updatable-content" data-socket-channel="do-not-read">failed <relative-time>two hours ago</relative-time> in 1m 12s</span></div>
    </div>
    <div class="js-check-steps"><details class="js-checks-log-details"><summary class="js-check-step-summary">
      <span class="CheckStep-title"><span class="CheckStep-titleName">Set up job</span></span>
      <div class="text-mono text-normal text-small float-right">2s</div>
    </summary><pre>SECRET=do-not-read</pre></details></div>`,
  );
  document.querySelector("streaming-graph-job")?.remove();
  expect(readJobContext(document, new URL(location.href), root)).toMatchObject({
    name: "test matrix (linux, 22)",
    duration: "1m 12s",
    runner: null,
  });
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  expect(inspector.panel.querySelector("button")?.hidden).toBe(false);
  inspector.panel.querySelector("button")?.click();
  expect(root.querySelector("details")?.open).toBe(true);
  expect(inspector.header.textContent).not.toContain("do-not-read");
  expect(inspector.panel.textContent).not.toContain("do-not-read");
  inspector.remove();
});

it("uses native setup control handlers and keeps run-level facts outside the job inspector", () => {
  const root = setup(
    '<div class="js-check-steps"><button aria-expanded="false">Set up job</button><pre>Original native logs</pre></div>',
  );
  history.replaceState({}, "", `${run}/job/11?attempt=2`);
  const showLogs = vi.fn();
  const click = vi.fn();
  const nativeSetup = root.querySelector("button");
  nativeSetup?.addEventListener("click", click);
  const inspector = createJobInspector(document, window, showLogs);
  inspector.refresh(root);
  document.body.append(inspector.panel);
  inspector.panel.querySelector("button")?.click();
  expect(showLogs).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector(".js-check-steps button")).toBe(nativeSetup);
  expect(inspector.panel.querySelector("a")).toBeNull();
  expect(inspector.panel.textContent).not.toContain("artifacts");
  expect(inspector.panel.textContent).toContain("Job #11");
  inspector.remove();
});

it("mounts compact facts inside the title bar without a duplicate job name or right-pane header", () => {
  const root = setup("<dl><dt>Runner</dt><dd>hosted-linux</dd></dl>");
  history.replaceState({}, "", `${run}/job/11?attempt=2`);
  const actions = document.querySelector(".PageHeader-actions");
  const actionsParent = actions?.parentElement;
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  expect(inspector.header.parentElement).toBe(actionsParent);
  expect(inspector.header.nextElementSibling).toBe(actions);
  expect(actions?.parentElement).toBe(actionsParent);
  expect(inspector.header.textContent).toBe("Runner hosted-linux");
  expect(inspector.header.querySelector("h2")).toBeNull();
  expect(inspector.header.textContent).not.toContain("test linux");
  expect(document.querySelector(".ae-job-context")).toBeNull();
  expect(
    root.querySelector('[data-actions-enhanced="job-header-facts"]'),
  ).toBeNull();
  history.replaceState({}, "", `${run}?ae_view=artifacts&ae_job=12`);
  inspector.refresh(root);
  expect(inspector.panel.textContent).toContain("Job #12");
  expect(inspector.header.textContent).not.toContain("Passed");
  expect(inspector.header.textContent).not.toContain("1m 12s");
  inspector.remove();
  expect(
    document.querySelector('[data-actions-enhanced="job-header-facts"]'),
  ).toBeNull();
  expect(actions?.parentElement).toBe(actionsParent);
});

it("reattaches facts after native title-bar replacement and omits unavailable metadata", () => {
  const root = setup();
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  const oldBar = document.querySelector(".PageHeader-titleBar");
  const replacement = document.createElement("div");
  replacement.className = "PageHeader-titleBar";
  oldBar?.replaceWith(replacement);
  inspector.refresh(root);
  expect(inspector.header.parentElement).toBe(replacement);
  expect(document.querySelectorAll(".ae-job-header-facts")).toHaveLength(1);
  document.querySelector("nav")?.remove();
  document.querySelector("streaming-graph-job")?.remove();
  inspector.refresh(root);
  expect(inspector.header.hidden).toBe(true);
  expect(inspector.header.textContent).toBe("");
  expect(inspector.panel.textContent).toContain("Job #11");
  inspector.remove();
});

it("leaves status and duration to the combined header and only shows attempts above two", () => {
  const root = setup();
  const nativeRunStatus = document.createElement("span");
  nativeRunStatus.className = "actions-workflow-runs-status";
  nativeRunStatus.innerHTML =
    '<svg class="octicon octicon-check-circle-fill"></svg>';
  document.querySelector("page-header")?.prepend(nativeRunStatus);
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  expect(inspector.header.textContent).not.toContain("Passed");
  expect(inspector.header.textContent).not.toContain("1m 12s");
  document
    .querySelector("nav a svg")
    ?.setAttribute("class", "octicon octicon-x-circle-fill");
  inspector.refresh(root);
  expect(inspector.header.textContent).not.toContain("Failed");
  for (const attempt of [1, 2, 3]) {
    history.replaceState({}, "", `${run}/job/11?attempt=${attempt}`);
    inspector.refresh(root);
    expect(inspector.header.textContent.includes(`Attempt ${attempt}`)).toBe(
      attempt > 2,
    );
  }
  inspector.remove();
});

it("leaves all rendered job summaries to the workflow-level panel", () => {
  const root = setup("<job-summary>Selected job output</job-summary>");
  const unrelated = document.createElement("job-summary");
  unrelated.textContent = "Another job's run summary";
  document.body.append(unrelated);
  const inspector = createJobInspector(document, window, vi.fn());
  inspector.refresh(root);
  expect(inspector.panel.textContent).not.toContain("Selected job output");
  expect(inspector.panel.textContent).not.toContain("Another job");
  inspector.remove();
});
