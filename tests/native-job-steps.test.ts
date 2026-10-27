// @vitest-environment-options {"url":"https://github.com/"}
import { afterEach, expect, it, vi } from "vitest";
import { requestJobSteps } from "../lib/job-steps";
import { installNativeJobSteps } from "../lib/native-job-steps";

vi.mock("../lib/job-steps", () => ({
  requestJobSteps: vi.fn(),
  jobStepHref: (url: URL, number: number) => {
    const target = new URL(url);
    target.searchParams.set("ae_step", String(number));
    return target.href;
  },
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.resetAllMocks();
});

it("loads native list steps only on expansion, reuses loaded rows, and restores on cleanup", async () => {
  history.replaceState({}, "", "/acme/widget/actions/runs/102");
  document.body.innerHTML =
    '<aside><nav aria-label="Workflow run"><ul><li><a href="/acme/widget/actions/runs/102/job/11"><span data-component="ActionList.Item.Label">Build</span></a></li></ul></nav></aside>';
  const pane = document.querySelector("aside");
  if (!pane) throw new Error("Missing pane");
  vi.mocked(requestJobSteps).mockResolvedValue([
    {
      number: 2,
      name: "Skipped test",
      status: "skipped",
      duration: null,
      startedAt: null,
      completedAt: null,
    },
    {
      number: 1,
      name: "Set up job",
      status: "success",
      duration: "2s",
      startedAt: null,
      completedAt: null,
    },
  ]);
  const steps = installNativeJobSteps(document, window);
  steps.refresh(pane);
  expect(requestJobSteps).not.toHaveBeenCalled();
  const disclosure = pane.querySelector("details");
  if (!disclosure) throw new Error("Missing disclosure");
  expect(
    disclosure.querySelector("svg")?.classList.contains("octicon-chevron-down"),
  ).toBe(true);
  expect(disclosure.querySelector("path")?.getAttribute("d")).toBe(
    "M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z",
  );
  disclosure.open = true;
  disclosure.dispatchEvent(new Event("toggle"));
  await vi.waitFor(() =>
    expect(pane.querySelector(".ae-native-step-link")?.textContent).toContain(
      "Set up job2s",
    ),
  );
  expect(
    pane.querySelector<HTMLAnchorElement>(".ae-native-step-link")?.href,
  ).toContain("ae_step=1");
  expect(pane.querySelectorAll(".ae-native-step-link")).toHaveLength(1);
  expect(pane.textContent).not.toContain("Skipped test");
  disclosure.open = false;
  disclosure.dispatchEvent(new Event("toggle"));
  disclosure.open = true;
  disclosure.dispatchEvent(new Event("toggle"));
  expect(requestJobSteps).toHaveBeenCalledOnce();
  steps.refresh(pane);
  expect(pane.querySelectorAll("details")).toHaveLength(1);
  steps.remove();
  expect(pane.querySelector("details")).toBeNull();
  expect(pane.querySelector("nav a")?.textContent).toBe("Build");
});
