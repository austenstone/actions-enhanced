import { afterEach, expect, it, vi } from "vitest";
import { installNativeLogToolbar } from "../lib/native-log-toolbar";

let toolbar: ReturnType<typeof installNativeLogToolbar> | undefined;
const step = (number: number, open = false) => `
  <details class="js-checks-log-details" id="step-${number}" ${open ? "open" : ""}>
    <summary class="js-check-step-summary">Step ${number}</summary>
    <div class="native-log">Native content
      <details class="js-checks-log-group"><summary>Group</summary></details>
    </div>
  </details>`;
const setup = (nativeControls = true) => {
  document.body.innerHTML = `
    <split-page-layout data-ae-workspace>
      <main class="PageLayout-content" style="overflow-y:auto">
        <section aria-label="Check run summary"><div class="CheckRun js-check-steps">
          <div class="js-checks-log-toolbar">
            ${
              nativeControls
                ? `
              <input class="js-checks-log-search-input" aria-label="Search">
              <a class="js-steps-dropdown-log-archive" href="/native-archive">Download log archive</a>
              <a class="js-steps-dropdown-raw-logs" href="/native-raw">Raw logs</a>
            `
                : ""
            }
          </div>
          <div class="js-full-logs-container">${step(1)}${step(2, true)}
            <details id="unrelated"><summary>Native options</summary></details>
          </div>
        </div></section>
      </main>
    </split-page-layout>`;
  toolbar = installNativeLogToolbar(document, window);
  toolbar.refresh();
};
const control = (label: string) => {
  const element = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-actions-enhanced="native-log-toolbar"] button',
    ),
  ).find((element) => element.textContent === label);
  if (!element) throw new Error(`Missing ${label} control`);
  return element;
};
afterEach(() => {
  toolbar?.remove();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("operates real native summaries without replacing renderers or changing scroll position", () => {
  setup();
  const logs = document.querySelector(".js-check-steps");
  const line = document.querySelector(".native-log");
  const parent = line?.parentElement;
  const pane = document.querySelector<HTMLElement>(".PageLayout-content");
  const container = document.querySelector<HTMLElement>(
    ".js-full-logs-container",
  );
  const nativeSummary = document.querySelector("#step-1 > summary");
  const click = vi.fn(() => {
    if (pane) pane.scrollTop = 500;
    if (container) container.scrollTop = 600;
  });
  nativeSummary?.addEventListener("click", click);
  if (pane) pane.scrollTop = 120;
  if (container) container.scrollTop = 90;
  control("Expand steps").click();
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector<HTMLDetailsElement>("#step-1")?.open).toBe(
    true,
  );
  expect(document.querySelector<HTMLDetailsElement>("#step-2")?.open).toBe(
    true,
  );
  expect(document.querySelector<HTMLDetailsElement>("#unrelated")?.open).toBe(
    false,
  );
  expect(control("Expand steps").disabled).toBe(true);
  expect(pane?.scrollTop).toBe(120);
  expect(container?.scrollTop).toBe(90);
  expect(document.querySelector(".native-log")).toBe(line);
  expect(line?.parentElement).toBe(parent);
  expect(document.querySelector(".js-check-steps")).toBe(logs);
  control("Collapse steps").click();
  expect(document.querySelector<HTMLDetailsElement>("#step-1")?.open).toBe(
    false,
  );
  expect(control("Collapse steps").disabled).toBe(true);
});

it("toggles only loaded native log groups and refreshes newly loaded controls", () => {
  setup();
  control("Expand groups").click();
  expect(
    Array.from(
      document.querySelectorAll<HTMLDetailsElement>(".js-checks-log-group"),
    ).every((group) => group.open),
  ).toBe(true);
  control("Collapse groups").click();
  expect(
    Array.from(
      document.querySelectorAll<HTMLDetailsElement>(".js-checks-log-group"),
    ).every((group) => !group.open),
  ).toBe(true);
  document
    .querySelectorAll(".js-checks-log-group")
    .forEach((group) => group.remove());
  toolbar?.refresh();
  expect(control("Expand groups").hidden).toBe(true);
  document
    .querySelector(".native-log")
    ?.insertAdjacentHTML(
      "beforeend",
      '<details class="js-checks-log-group"><summary>New group</summary></details>',
    );
  toolbar?.refresh();
  expect(control("Expand groups").hidden).toBe(false);
});

it("focuses native search and triggers original download/raw links with their handlers", () => {
  setup();
  const input = document.querySelector<HTMLInputElement>(
    ".js-checks-log-search-input",
  );
  if (!input) throw new Error("Missing native search");
  const intoView = vi
    .spyOn(input, "scrollIntoView")
    .mockImplementation(() => {});
  const downloads = vi.fn((event: Event) => event.preventDefault());
  const raw = vi.fn((event: Event) => event.preventDefault());
  document
    .querySelector(".js-steps-dropdown-log-archive")
    ?.addEventListener("click", downloads);
  document
    .querySelector(".js-steps-dropdown-raw-logs")
    ?.addEventListener("click", raw);
  control("Search").click();
  expect(document.activeElement).toBe(input);
  expect(intoView).toHaveBeenCalledOnce();
  expect(document.querySelectorAll(".js-checks-log-search-input")).toHaveLength(
    1,
  );
  control("Download").click();
  control("Raw").click();
  expect(downloads).toHaveBeenCalledOnce();
  expect(raw).toHaveBeenCalledOnce();
});

it("does not invent search or downloads, hide setup-like user steps, or intercept shortcuts", () => {
  setup(false);
  expect(control("Search").hidden).toBe(true);
  expect(control("Download").hidden).toBe(true);
  expect(control("Raw").hidden).toBe(true);
  const summary = document.querySelector("#step-1 > summary");
  if (summary) summary.textContent = "Set up job";
  toolbar?.refresh();
  expect(document.querySelector<HTMLElement>("#step-1")?.hidden).toBe(false);
  const event = new KeyboardEvent("keydown", {
    key: "f",
    metaKey: true,
    cancelable: true,
    bubbles: true,
  });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("navigates the real scrolling log pane without scrolling its outer page", () => {
  setup();
  const pane = document.querySelector<HTMLElement>(".PageLayout-content");
  if (!pane) throw new Error("Missing pane");
  Object.defineProperties(pane, {
    scrollHeight: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 300 },
  });
  document.documentElement.scrollTop = 30;
  pane.scrollTop = 120;
  control("End").click();
  expect(pane.scrollTop).toBe(900);
  expect(document.documentElement.scrollTop).toBe(30);
  control("Top").click();
  expect(pane.scrollTop).toBe(0);
});

it("refreshes idempotently for native job changes and removes only owned UI", () => {
  setup();
  toolbar?.refresh();
  toolbar?.refresh();
  expect(document.querySelectorAll(".ae-native-log-toolbar")).toHaveLength(1);
  const oldLogs = document.querySelector(".js-check-steps");
  const next = document.createElement("div");
  next.className = "CheckRun js-check-steps";
  next.innerHTML = step(3);
  oldLogs?.replaceWith(next);
  toolbar?.refresh();
  expect(oldLogs?.querySelector(".ae-native-log-toolbar")).toBeNull();
  expect(next.querySelectorAll(".ae-native-log-toolbar")).toHaveLength(1);
  const summary = next.querySelector("summary");
  toolbar?.remove();
  expect(next.querySelector(".ae-native-log-toolbar")).toBeNull();
  expect(next.querySelector("summary")).toBe(summary);
});

it("does not mount on unsupported summary pages or duplicate another installation", () => {
  document.body.innerHTML = '<div class="js-check-steps">Not a workspace</div>';
  toolbar = installNativeLogToolbar(document, window);
  toolbar.refresh();
  expect(document.querySelector(".ae-native-log-toolbar")).toBeNull();
  toolbar.remove();
  setup();
  const second = installNativeLogToolbar(document, window);
  second.refresh();
  expect(document.querySelectorAll(".ae-native-log-toolbar")).toHaveLength(1);
  second.remove();
  expect(document.querySelectorAll(".ae-native-log-toolbar")).toHaveLength(1);
});

it("refreshes without DOM churn, focus loss, or resetting native log scroll", () => {
  setup();
  const pane = document.querySelector<HTMLElement>(".PageLayout-content");
  if (!pane) throw new Error("Missing pane");
  const nativeInput = document.querySelector<HTMLInputElement>(
    ".js-checks-log-search-input",
  );
  nativeInput?.focus();
  pane.scrollTop = 123;
  pane.scrollLeft = 45;
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  toolbar?.refresh();
  toolbar?.refresh();
  expect(observer.takeRecords()).toHaveLength(0);
  observer.disconnect();
  expect(document.activeElement).toBe(nativeInput);
  expect(pane.scrollTop).toBe(123);
  expect(pane.scrollLeft).toBe(45);
});

it("updates availability when a user toggles a native summary", () => {
  setup();
  control("Expand steps").click();
  expect(control("Expand steps").disabled).toBe(true);
  const step = document.querySelector<HTMLDetailsElement>("#step-1");
  if (!step) throw new Error("Missing step");
  step.open = false;
  step.dispatchEvent(new Event("toggle"));
  expect(control("Expand steps").disabled).toBe(false);
  expect(control("Collapse steps").disabled).toBe(false);
});

it("uses the innermost scrolling native log container when available", () => {
  setup();
  const container = document.querySelector<HTMLElement>(
    ".js-full-logs-container",
  );
  const pane = document.querySelector<HTMLElement>(".PageLayout-content");
  if (!container || !pane) throw new Error("Missing log container");
  container.style.overflowY = "auto";
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
  });
  pane.scrollTop = 50;
  control("End").click();
  expect(container.scrollTop).toBe(1000);
  expect(pane.scrollTop).toBe(50);
  control("Top").click();
  expect(container.scrollTop).toBe(0);
});
