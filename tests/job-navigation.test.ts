// @vitest-environment-options {"url":"https://github.com"}
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../entrypoints/actions.content/App";
import { type Item, readSurface, type Surface } from "../lib/github";
import {
  jobNavigation,
  readNavigationState,
  revealInSidebar,
  runPathFor,
  saveNavigationState,
} from "../lib/job-navigation";

let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("tab-scoped job navigation", () => {
  const runPath = "/acme/widget/actions/runs/102";
  it("uses the same run key for summary and all its job pages", () => {
    expect(runPathFor(runPath)).toBe(runPath);
    expect(runPathFor(`${runPath}/job/12`)).toBe(runPath);
    expect(runPathFor("/acme/widget/issues")).toBe("");
    expect(runPathFor(`${runPath}invalid`)).toBe("");
  });
  it("restores filters and sidebar scroll only for the same run", () => {
    const state = {
      runPath,
      query: "linux",
      filter: "failure" as const,
      scrollTop: 140,
    };
    expect(saveNavigationState(state)).toBe("");
    expect(readNavigationState(runPath)).toEqual({ state, error: "" });
    expect(
      readNavigationState("/acme/widget/actions/runs/103").state,
    ).toMatchObject({
      query: "",
      filter: "all",
      scrollTop: 0,
    });
  });
  it("rejects malformed state and exposes storage errors", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    sessionStorage.setItem(
      "actions-enhanced:job-navigation",
      JSON.stringify({
        runPath,
        query: "linux",
        filter: "made-up",
        scrollTop: -1,
      }),
    );
    expect(readNavigationState(runPath).error).toContain(
      "could not be restored",
    );
    expect(readNavigationState(runPath).state.filter).toBe("all");
    vi.stubGlobal("sessionStorage", {
      getItem: sessionStorage.getItem.bind(sessionStorage),
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(
      saveNavigationState({ runPath, query: "", filter: "all", scrollTop: 0 }),
    ).toContain("cannot remember");
    expect(warning).not.toHaveBeenCalled();
  });
});

const runPath = "/acme/widget/actions/runs/102";
const items = (statuses: Item["status"][]): Item[] =>
  statuses.map((status, index) => ({
    id: `${runPath}/job/${index + 1}`,
    url: `https://github.com${runPath}/job/${index + 1}`,
    title: `job ${index + 1}`,
    status,
    workflow: "",
    number: "",
    branch: "",
    actor: "",
    duration: "",
    timestamp: "",
  }));

describe("job selection and failure navigation", () => {
  const jobs = items([
    "success",
    "failure",
    "unknown",
    "failure",
    "action_required",
    "queued",
    "in_progress",
    "cancelled",
    "skipped",
  ]);
  it("counts only explicit statuses, without treating unknown as passed or failed", () => {
    expect(jobNavigation(jobs, "")).toMatchObject({
      currentIndex: -1,
      failureIndex: -1,
      attention: 3,
      active: 2,
      passed: 1,
      previous: undefined,
      next: undefined,
      nextFailure: jobs[1],
    });
    expect(jobNavigation(jobs, "").failures).toHaveLength(2);
  });
  it("chooses the next failure after a selected nonfailed job", () => {
    expect(jobNavigation(jobs, `${runPath}/job/3`)).toMatchObject({
      currentIndex: 2,
      failureIndex: -1,
      previous: jobs[1],
      next: jobs[3],
      previousFailure: jobs[1],
      nextFailure: jobs[3],
    });
  });
  it("wraps failures in native order and exposes the selected failure position", () => {
    expect(jobNavigation(jobs, `${runPath}/job/4`)).toMatchObject({
      failureIndex: 1,
      previousFailure: jobs[1],
      nextFailure: jobs[1],
    });
    expect(jobNavigation(jobs, `${runPath}/job/9`).nextFailure).toBe(jobs[1]);
    expect(jobNavigation([], "")).toMatchObject({
      previousFailure: undefined,
      nextFailure: undefined,
      attention: 0,
      active: 0,
      passed: 0,
    });
    expect(jobNavigation(items(["failure"]), `${runPath}/job/1`)).toMatchObject(
      {
        failureIndex: 0,
        currentIndex: 0,
      },
    );
  });
  it("reveals only rows outside the available sidebar viewport", () => {
    const pane = document.createElement("aside");
    const row = document.createElement("a");
    pane.scrollTop = 100;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 600,
    } as DOMRect);
    const bounds = vi.spyOn(row, "getBoundingClientRect");
    bounds.mockReturnValue({ top: 210, bottom: 240 } as DOMRect);
    revealInSidebar(pane, row, 80);
    expect(pane.scrollTop).toBe(100);
    bounds.mockReturnValue({ top: 160, bottom: 190 } as DOMRect);
    revealInSidebar(pane, row, 80);
    expect(pane.scrollTop).toBe(72);
    bounds.mockReturnValue({ top: 600, bottom: 630 } as DOMRect);
    revealInSidebar(pane, row, 80);
    expect(pane.scrollTop).toBe(110);
  });
});

describe("native control lifecycle", () => {
  const navigate = (path: string) => {
    history.replaceState({}, "", `https://github.com${path}`);
  };
  const mount = () => {
    const nav = document.createElement("nav");
    nav.innerHTML = items(["success", "failure", "failure"])
      .map(
        (job) =>
          `<li><a href="${job.id}"><svg class="octicon octicon-${job.status === "failure" ? "x-circle-fill" : "check-circle-fill"}"></svg>${job.title}</a></li>`,
      )
      .join("");
    const pane = document.createElement("aside");
    pane.className = "PageLayout-pane";
    const container = document.createElement("div");
    container.setAttribute("data-actions-enhanced", "");
    pane.append(container, nav);
    document.body.append(pane);
    const surface = readSurface(document, new URL(location.href));
    if (!surface) throw new Error("Missing test surface");
    root = createRoot(container);
    act(() => root?.render(createElement(App, { surface })));
    return { pane, nav, container, surface };
  };
  const flushFrames = () => act(() => vi.advanceTimersByTime(20));
  const setFilter = (value: string) =>
    act(() => {
      const select = document.querySelector("select");
      if (!select) throw new Error("Missing filter");
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    navigate(runPath);
  });
  it("uses ae_job selection, keeps it visible outside the filter, and updates on back/forward", () => {
    navigate(`${runPath}?ae_view=graph&ae_job=1`);
    const { nav, container } = mount();
    setFilter("failure");
    expect(nav.querySelector("li")?.style.display).not.toBe("none");
    expect(container.textContent).toContain("current job kept visible");
    expect(
      container.querySelector('[aria-label="Next job"]')?.getAttribute("href"),
    ).toBe(`https://github.com${runPath}/job/2?ae_view=graph`);
    act(() => {
      navigate(`${runPath}?ae_view=graph&ae_job=3`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(container.textContent).toContain("Failure 2 of 2");
    expect(nav.querySelector("li")?.style.display).toBe("none");
    expect(container.querySelector("select")?.value).toBe("failure");
  });
  it("saves the latest filter without a stale effect cleanup overwriting it", () => {
    const { pane } = mount();
    flushFrames();
    pane.scrollTop = 321;
    act(() => pane.dispatchEvent(new Event("scroll")));
    setFilter("failure");
    setFilter("active");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(readNavigationState(runPath).state).toMatchObject({
      filter: "active",
      scrollTop: 321,
    });
    act(() => root?.unmount());
    root = undefined;
    expect(readNavigationState(runPath).state.filter).toBe("active");
    mount();
    expect(document.querySelector("select")?.value).toBe("active");
  });
  it("does not restore scroll again during a live status update", () => {
    navigate(`${runPath}/job/2`);
    const { pane, surface } = mount();
    flushFrames();
    pane.scrollTop = 222;
    act(() => pane.dispatchEvent(new Event("scroll")));
    const updated: Surface = {
      ...surface,
      items: surface.items.map((item) => ({ ...item, status: "queued" })),
    };
    act(() => root?.render(createElement(App, { surface: updated })));
    flushFrames();
    expect(pane.scrollTop).toBe(222);
    expect(readNavigationState(runPath).state.scrollTop).toBe(222);
  });
  it("restores the latest scroll when the native pane is replaced", () => {
    const { pane, surface, container } = mount();
    flushFrames();
    pane.scrollTop = 246;
    act(() => pane.dispatchEvent(new Event("scroll")));
    const replacement = pane.cloneNode(true) as HTMLElement;
    const anchor = replacement.querySelector("nav");
    if (!anchor) throw new Error("Missing replacement nav");
    replacement.querySelector("[data-actions-enhanced]")?.remove();
    replacement.prepend(container);
    pane.replaceWith(replacement);
    const next = { ...surface, anchor };
    act(() => root?.render(createElement(App, { surface: next })));
    flushFrames();
    expect(replacement.scrollTop).toBe(246);
    expect(replacement.hasAttribute("data-ae-job-pane")).toBe(true);
    expect(pane.hasAttribute("data-ae-job-pane")).toBe(false);
  });
  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { button: 1 },
    {},
  ])(
    "keeps native click semantics and adds view context only during an explicit click: %s",
    (modifiers) => {
      navigate(`${runPath}?ae_view=graph&ae_job=1`);
      const { nav } = mount();
      const link = nav.querySelector("a");
      if (!link) throw new Error("Missing native link");
      const original = link.getAttribute("href");
      expect(original).toBe(`${runPath}/job/1`);
      const event = new MouseEvent(modifiers.button ? "auxclick" : "click", {
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      link.addEventListener(event.type, () => {
        expect(link.href).toBe(
          `https://github.com${runPath}/job/1?ae_view=graph`,
        );
        expect(event.defaultPrevented).toBe(false);
        event.preventDefault();
      });
      act(() => link.dispatchEvent(event));
      act(() => vi.advanceTimersByTime(1));
      expect(link.getAttribute("href")).toBe(original);
    },
  );
  it("leaves a focused native row visible across live filter updates", () => {
    const { nav, surface } = mount();
    nav.querySelector("a")?.focus();
    setFilter("failure");
    expect(nav.querySelector("li")?.style.display).not.toBe("none");
    act(() =>
      root?.render(
        createElement(App, {
          surface: {
            ...surface,
            items: surface.items.map((item) => ({ ...item })),
          },
        }),
      ),
    );
    expect(nav.querySelector("a")).toBe(document.activeElement);
    expect(nav.querySelector("li")?.style.display).not.toBe("none");
  });
  it("does not transform native summary links or links to a different run", () => {
    navigate(`${runPath}?ae_view=graph&ae_job=1`);
    const { nav } = mount();
    [
      `${runPath}?ae_job=1`,
      "/acme/widget/actions/runs/103/job/1",
      "https://example.com/acme/widget/actions/runs/102/job/1",
    ].forEach((href) => {
      const link = document.createElement("a");
      link.href = href;
      nav.append(link);
      link.addEventListener("click", (event) => {
        expect(link.getAttribute("href")).toBe(href);
        event.preventDefault();
      });
      act(() =>
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        ),
      );
    });
  });
  it("shows a storage warning without console spam on repeated saves", () => {
    const warn = vi.spyOn(console, "warn");
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { pane, container } = mount();
    setFilter("failure");
    act(() => pane.dispatchEvent(new Event("scroll")));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(container.textContent).toContain("cannot remember job navigation");
    expect(warn).not.toHaveBeenCalled();
  });
});
