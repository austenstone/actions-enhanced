// @vitest-environment-options {"url":"https://github.com/"}
import { afterEach, expect, it } from "vitest";
import { installRunDetails, transferRunDetails } from "../lib/run-details";

let details: ReturnType<typeof installRunDetails> | undefined;
afterEach(() => {
  details?.remove();
  document.body.replaceChildren();
});
const setup = () => {
  history.replaceState(
    {},
    "",
    "/acme/widget/actions/runs/102?ae_view=run-summary",
  );
  document.body.innerHTML = `<split-page-layout data-ae-workspace><aside class="PageLayout-pane"></aside><main class="PageLayout-content"><div id="origin">
  <div role="region" aria-label="Workflow run summary">Native metadata</div>
  <job-summaries><job-summary>PR summary<button id="options">Menu</button></job-summary></job-summaries>
  <div role="region" aria-label="Annotations"><annotation-message>Warning</annotation-message></div>
  <div role="region" aria-label="Artifacts"><a href="/artifact.zip">Download</a></div>
  </div></main></split-page-layout>`;
  details = installRunDetails(document, window);
  details.refresh();
};
it("places all native run-level sections on separate left tabs without rebuilding nodes", () => {
  setup();
  const pane = document.querySelector(".PageLayout-pane");
  const summary = document.querySelector("job-summaries");
  const slot = document.querySelector<HTMLElement>(
    '[data-ae-native-section="run-summary"]',
  );
  expect(pane?.contains(summary)).toBe(true);
  expect(slot?.hidden).toBe(false);
  expect(
    document.querySelector(".PageLayout-content")?.textContent,
  ).not.toContain("PR summary");
  expect(
    document
      .querySelector('[data-ae-native-section="annotations"]')
      ?.contains(document.querySelector("annotation-message")),
  ).toBe(true);
  history.replaceState({}, "", "?ae_view=artifacts");
  details?.refresh();
  expect(slot?.hidden).toBe(true);
  expect(
    document.querySelector<HTMLElement>('[data-ae-native-section="artifacts"]')
      ?.hidden,
  ).toBe(false);
  details?.remove();
  expect(document.querySelector("#origin")?.contains(summary)).toBe(true);
  expect(document.getElementById("options")).not.toBeNull();
});
it("preserves selected native job logs when incoming workflow sections are transferred", () => {
  setup();
  const content = document.querySelector(".PageLayout-content");
  if (content)
    content.innerHTML =
      '<section aria-label="Check run summary" id="logs">Live logs</section>';
  details?.refresh();
  const logs = document.getElementById("logs");
  const incoming = document.createElement("main");
  incoming.innerHTML =
    '<div role="region" aria-label="Workflow run summary">Incoming summary</div>';
  const pane = document.querySelector(".PageLayout-pane");
  if (pane) transferRunDetails(document, incoming, pane);
  details?.refresh();
  expect(document.getElementById("logs")).toBe(logs);
  expect(
    document.querySelector('[data-actions-enhanced="job-selection-empty"]'),
  ).toBeNull();
  expect(
    document.querySelectorAll('[data-ae-native-section="run-summary"]'),
  ).toHaveLength(1);
});
it("adds honest empty states when the run has no annotations or artifacts", () => {
  document.body.innerHTML =
    '<aside id="pane"></aside><main id="source"><div role="region" aria-label="Workflow run summary">Run</div></main>';
  const source = document.getElementById("source");
  const pane = document.getElementById("pane");
  if (source && pane) transferRunDetails(document, source, pane);
  expect(pane?.textContent).toContain("No annotations for this run.");
  expect(pane?.textContent).toContain("No artifacts for this run.");
});

it("replaces the empty slot when native annotations arrive after the summary moved", () => {
  setup();
  const slot = document.querySelector<HTMLElement>(
    '[data-ae-native-section="annotations"]',
  );
  if (!slot) throw new Error("Missing annotations slot");
  slot.replaceChildren();
  const empty = document.createElement("p");
  empty.setAttribute("data-ae-section-empty", "");
  empty.textContent = "No annotations";
  slot.append(empty);
  const incoming = document.createElement("div");
  incoming.setAttribute("role", "region");
  incoming.setAttribute("aria-label", "Annotations");
  incoming.innerHTML = "<annotation-message>Late notice</annotation-message>";
  document.querySelector(".PageLayout-content")?.append(incoming);
  details?.refresh();
  expect(slot.contains(incoming)).toBe(true);
  expect(slot.querySelector("[data-ae-section-empty]")).toBeNull();
  details?.refresh();
  expect(slot.querySelectorAll("annotation-message")).toHaveLength(1);
});
