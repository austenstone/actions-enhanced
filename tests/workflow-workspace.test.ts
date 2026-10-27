// @vitest-environment-options {"url":"https://github.com/"}
import { afterEach, expect, it, vi } from "vitest";
import { installNativeNavigation } from "../entrypoints/native-navigation.content";
import {
  installWorkflowWorkspace,
  requestNativeVisit,
} from "../lib/workflow-workspace";

const run = "/acme/widget/actions/runs/102";
let workspace: ReturnType<typeof installWorkflowWorkspace>;
let removeNavigation: (() => void) | undefined;
const setup = (path = `${run}/job/11?ae_view=table`) => {
  history.replaceState({}, "", path);
  document.body.innerHTML = `<split-page-layout><div class="PageLayout-columns">
    <aside class="PageLayout-pane"><div id="ae-run-experience" data-actions-enhanced="run-experience">
      <nav aria-label="Run views"><a id="summary" href="${run}/job/11">Summary</a></nav></div>
      <nav aria-label="Workflow run"><ul>
        <li class="ActionListItem ActionListItem--navActive" data-active="true"><a id="first" aria-current="page" href="${run}/job/11">build</a></li>
        <li class="ActionListItem"><a id="second" href="${run}/job/12">test</a></li>
      </ul></nav></aside>
    <main class="PageLayout-content"><action-graph>Native graph</action-graph><section id="logs">Native logs</section></main>
    </div></split-page-layout>`;
  workspace = installWorkflowWorkspace(document, window);
  removeNavigation = installNativeNavigation(document, window);
};
afterEach(() => {
  workspace?.remove();
  removeNavigation?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("changes view locally without reapplying the previous view to a job-shaped tab URL", () => {
  setup();
  document.getElementById("summary")?.click();
  expect(new URL(location.href).searchParams.has("ae_view")).toBe(false);
  expect(
    document
      .querySelector("split-page-layout")
      ?.getAttribute("data-ae-run-view"),
  ).toBe("summary");
});

it("syncs native selected-row styling, semantics and restoration when augmented navigation changes jobs", () => {
  setup();
  history.pushState({}, "", `${run}/job/12?ae_view=table`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const first = document.getElementById("first");
  const second = document.getElementById("second");
  expect(first?.hasAttribute("aria-current")).toBe(false);
  expect(first?.parentElement?.hasAttribute("data-active")).toBe(false);
  expect(
    first?.parentElement?.classList.contains("ActionListItem--navActive"),
  ).toBe(false);
  expect(second?.getAttribute("aria-current")).toBe("page");
  expect(second?.parentElement?.getAttribute("data-active")).toBe("true");
  expect(
    second?.parentElement?.classList.contains("ActionListItem--navActive"),
  ).toBe(true);
  workspace?.remove();
  expect(first?.getAttribute("aria-current")).toBe("page");
  expect(first?.parentElement?.getAttribute("data-active")).toBe("true");
  expect(second?.hasAttribute("aria-current")).toBe(false);
});

it("keeps the existing graph on the left without moving native logs and restores its location", () => {
  setup(`${run}?ae_view=graph`);
  const graph = document.querySelector("action-graph");
  const logs = document.getElementById("logs");
  expect(document.querySelector(".PageLayout-pane")?.contains(graph)).toBe(
    true,
  );
  expect(document.querySelector(".PageLayout-content")?.contains(logs)).toBe(
    true,
  );
  workspace?.remove();
  expect(document.querySelector(".PageLayout-content")?.contains(graph)).toBe(
    true,
  );
});

it("uses the public scoped Turbo renderer to replace only incoming native log content", () => {
  setup();
  const pane = document.querySelector(".PageLayout-pane");
  const experience = document.getElementById("ae-run-experience");
  document.dispatchEvent(
    new CustomEvent("turbo:before-visit", {
      detail: { url: `https://github.com${run}/job/12` },
    }),
  );
  const incoming = document.createElement("body");
  incoming.innerHTML = `<split-page-layout><aside class="PageLayout-pane">A new sidebar that must not replace the live one</aside><main class="PageLayout-content"><section id="new-logs">New native logs</section></main></split-page-layout>`;
  const detail = { newBody: incoming, render: vi.fn() };
  document.dispatchEvent(new CustomEvent("turbo:before-render", { detail }));
  detail.render();
  expect(document.querySelector(".PageLayout-pane")).toBe(pane);
  expect(document.getElementById("ae-run-experience")).toBe(experience);
  expect(document.getElementById("new-logs")?.textContent).toBe(
    "New native logs",
  );
  expect(document.getElementById("logs")).toBeNull();
});

it("loads workflow-level tabs into the left pane without replacing selected job logs", () => {
  setup();
  const logs = document.getElementById("logs");
  document.dispatchEvent(
    new CustomEvent("turbo:before-visit", {
      detail: { url: `https://github.com${run}?ae_view=artifacts&ae_job=11` },
    }),
  );
  const incoming = document.createElement("body");
  incoming.innerHTML = `<main class="PageLayout-content">
    <div role="region" aria-label="Workflow run summary">Workflow metadata</div>
    <job-summaries>PR summary</job-summaries>
    <div role="region" aria-label="Artifacts"><a href="/artifact.zip">Download</a></div>
  </main>`;
  const detail = { newBody: incoming, render: vi.fn() };
  document.dispatchEvent(new CustomEvent("turbo:before-render", { detail }));
  detail.render();
  expect(document.getElementById("logs")).toBe(logs);
  expect(
    document.querySelector(
      ".PageLayout-pane [data-ae-native-section='run-summary']",
    )?.textContent,
  ).toContain("PR summary");
  expect(
    document
      .querySelector(".PageLayout-pane [data-ae-native-section='artifacts'] a")
      ?.getAttribute("href"),
  ).toBe("/artifact.zip");
});

it("keeps default rendering for other runs and native links when Turbo is missing", () => {
  setup();
  expect(requestNativeVisit(new URL(`https://github.com${run}/job/12`))).toBe(
    false,
  );
  document.dispatchEvent(
    new CustomEvent("turbo:before-visit", {
      detail: { url: `https://github.com${run.replace("102", "103")}/job/12` },
    }),
  );
  const incoming = document.createElement("body");
  incoming.innerHTML = '<main class="PageLayout-content">Another run</main>';
  const original = vi.fn();
  const detail = { newBody: incoming, render: original };
  document.dispatchEvent(new CustomEvent("turbo:before-render", { detail }));
  expect(detail.render).toBe(original);
});

it("only accepts public Turbo visits within the current same-origin run", () => {
  setup();
  const visit = vi.fn();
  vi.stubGlobal("Turbo", { visit });
  expect(requestNativeVisit(new URL(`https://github.com${run}/job/12`))).toBe(
    true,
  );
  expect(visit).toHaveBeenCalledWith(`https://github.com${run}/job/12`, {
    action: "advance",
  });
  expect(requestNativeVisit(new URL(`https://example.com${run}/job/12`))).toBe(
    false,
  );
  expect(
    requestNativeVisit(
      new URL(`https://github.com${run.replace("102", "103")}/job/12`),
    ),
  ).toBe(false);
  expect(visit).toHaveBeenCalledTimes(1);
});

const layoutOf = () =>
  document
    .querySelector("split-page-layout")
    ?.getAttribute("data-ae-log-layout");
const choice = (name: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-ae-log-layout-choice="${name}"]`,
  );

it("switches log layouts in place with accessible pressed state and keeps native nodes and selection", () => {
  setup();
  const logs = document.getElementById("logs");
  const parent = logs?.parentElement;
  const pane = document.querySelector(".PageLayout-pane");
  const group = document.querySelector(
    '[role="group"][aria-label="Log layout"]',
  );
  expect(layoutOf()).toBe("side");
  expect(group?.querySelectorAll("button")).toHaveLength(4);
  expect(choice("side")?.getAttribute("aria-label")).toBe("Logs beside jobs");
  expect(choice("side")?.getAttribute("aria-pressed")).toBe("true");
  for (const name of ["below", "maximized", "fullscreen", "side"]) {
    choice(name)?.click();
    expect(layoutOf()).toBe(name);
    expect(choice(name)?.getAttribute("aria-pressed")).toBe("true");
    const param = new URL(location.href).searchParams.get("ae_layout");
    expect(param).toBe(name === "side" ? null : name);
    expect(document.getElementById("logs")).toBe(logs);
    expect(logs?.parentElement).toBe(parent);
    expect(document.querySelector(".PageLayout-pane")).toBe(pane);
    expect(location.pathname).toBe(`${run}/job/11`);
    expect(new URL(location.href).searchParams.get("ae_view")).toBe("table");
    expect(document.getElementById("first")?.getAttribute("aria-current")).toBe(
      "page",
    );
  }
});

it("exits fullscreen and maximized logs to the previous layout", () => {
  setup(`${run}/job/11?ae_view=table&ae_layout=below`);
  expect(layoutOf()).toBe("below");
  choice("fullscreen")?.click();
  expect(layoutOf()).toBe("fullscreen");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(layoutOf()).toBe("below");
  choice("maximized")?.click();
  choice("fullscreen")?.click();
  choice("fullscreen")?.click();
  expect(layoutOf()).toBe("maximized");
  choice("maximized")?.click();
  expect(layoutOf()).toBe("below");
});

it("clears fullscreen from the URL and does not restore it through stale view links", () => {
  setup(`${run}/job/11?ae_view=table&ae_layout=fullscreen`);
  const changed = vi.fn();
  window.addEventListener("popstate", changed);
  choice("fullscreen")?.click();
  expect(layoutOf()).toBe("side");
  expect(new URL(location.href).searchParams.has("ae_layout")).toBe(false);
  expect(changed).toHaveBeenCalled();
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Run views");
  const link = document.createElement("a");
  link.href = `${run}/job/11?ae_view=waterfall&ae_layout=fullscreen`;
  nav.append(link);
  document.querySelector(".PageLayout-pane")?.append(nav);
  link.click();
  expect(layoutOf()).toBe("side");
  expect(new URL(location.href).searchParams.has("ae_layout")).toBe(false);
  window.removeEventListener("popstate", changed);
});

it("closes logs so jobs fill the workspace without adding a reopen button", () => {
  setup(`${run}/job/11?ae_view=table&ae_layout=below`);
  const close = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Close logs"]',
  );
  const reopen = document.querySelector<HTMLButtonElement>(
    '[data-actions-enhanced="log-reopen"]',
  );
  expect(reopen).toBeNull();
  close?.click();
  expect(layoutOf()).toBe("closed");
  expect(new URL(location.href).searchParams.get("ae_layout")).toBe("closed");
  expect(document.activeElement?.closest(".PageLayout-pane")).not.toBeNull();
  workspace?.remove();
  expect(layoutOf()).toBeNull();
  expect(
    document.querySelector('[data-actions-enhanced="log-reopen"]'),
  ).toBeNull();
});

it("reopens logs when a job is selected from the closed jobs view and restores layout from history", () => {
  setup(`${run}/job/11?ae_view=table&ae_layout=below`);
  const visit = vi.fn();
  vi.stubGlobal("Turbo", { visit });
  document
    .querySelector<HTMLButtonElement>('button[aria-label="Close logs"]')
    ?.click();
  const step = document.getElementById("second");
  step?.setAttribute("href", `${run}/job/12?ae_step=1`);
  step?.click();
  const target = new URL(visit.mock.calls[0]?.[0]);
  expect(target.pathname).toBe(`${run}/job/12`);
  expect(target.searchParams.get("ae_layout")).toBe("below");
  expect(layoutOf()).toBe("below");
  history.replaceState({}, "", `${run}/job/11?ae_layout=fullscreen`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(layoutOf()).toBe("fullscreen");
});
