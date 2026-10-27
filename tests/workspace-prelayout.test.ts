import { afterEach, expect, it } from "vitest";
import { prepareWorkspace } from "../lib/workspace-prelayout";

const run = "https://github.com/acme/widget/actions/runs/102";
afterEach(() => document.body.replaceChildren());

it("reserves the workspace before native children or React exist", () => {
  document.body.innerHTML = "<split-page-layout></split-page-layout>";
  prepareWorkspace(
    document,
    new URL(`${run}/job/11?ae_layout=below&ae_view=table`),
  );
  const layout = document.querySelector("split-page-layout");
  expect(layout?.hasAttribute("data-ae-workspace")).toBe(true);
  expect(layout?.getAttribute("data-ae-log-layout")).toBe("below");
  expect(layout?.getAttribute("data-ae-run-view")).toBe("table");
  expect(layout?.getAttribute("data-ae-has-job")).toBe("true");
});

it("reserves full-width summaries and closed layouts", () => {
  document.body.innerHTML = "<split-page-layout></split-page-layout>";
  prepareWorkspace(document, new URL(`${run}?ae_layout=closed&ae_job=11`));
  const layout = document.querySelector("split-page-layout");
  expect(layout?.getAttribute("data-ae-has-job")).toBe("false");
  expect(layout?.getAttribute("data-ae-log-layout")).toBe("closed");
});

it("does not override an installed workspace or unrelated pages", () => {
  document.body.innerHTML =
    '<split-page-layout data-ae-workspace data-ae-has-job="true"></split-page-layout>';
  prepareWorkspace(document, new URL(run));
  expect(
    document
      .querySelector("split-page-layout")
      ?.getAttribute("data-ae-has-job"),
  ).toBe("true");
  document.body.innerHTML = "<split-page-layout></split-page-layout>";
  prepareWorkspace(document, new URL("https://github.com/acme/widget/issues"));
  expect(
    document
      .querySelector("split-page-layout")
      ?.hasAttribute("data-ae-workspace"),
  ).toBe(false);
});

it("tolerates document_start before the document element exists", () => {
  const early = document.implementation.createHTMLDocument();
  early.documentElement.remove();
  expect(() => prepareWorkspace(early, new URL(run))).not.toThrow();
});
