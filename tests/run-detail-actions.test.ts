import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installRunDetailActions,
  type RunDetailActions,
} from "../lib/run-detail-actions";

let actions: RunDetailActions | undefined;

afterEach(() => {
  actions?.remove();
  actions = undefined;
  document.body.innerHTML = "";
});

const fixture = (extra = "") => {
  document.body.innerHTML = `
    <div class="PageHeader-titleBar"><h1>Build</h1><button>Menu</button></div>
    <aside><div id="native"><h2>Run details</h2><ul>
      <li><a class="native-link" data-test-selector="usage-link" href="/usage"><svg class="octicon-stopwatch"></svg>Usage</a></li>
      <li><a data-test-selector="workflow-file-link" href="/workflow"><svg class="octicon-file-code"></svg><span>Workflow file</span></a></li>
      <li><a data-test-selector="lockfile-link" href="/lock"><svg class="octicon-lock"></svg>Lockfile</a></li>
    </ul>${extra}</div></aside>`;
};

const link = (name = "usage-link") =>
  document.querySelector<HTMLAnchorElement>(`a[data-test-selector="${name}"]`)!;

describe("native run detail actions", () => {
  it("moves actual anchors with their icons, destinations and click handlers", () => {
    fixture();
    const usage = link();
    const icon = usage.querySelector("svg");
    const click = vi.fn((event: Event) => event.preventDefault());
    usage.addEventListener("click", click);
    actions = installRunDetailActions();
    const group = document.querySelector(".ae-run-detail-actions");
    expect(group?.parentElement?.className).toBe("PageHeader-titleBar");
    expect(group?.lastElementChild).toBe(link("lockfile-link"));
    expect(group?.firstElementChild).toBe(usage);
    expect(usage.querySelector("svg")).toBe(icon);
    expect(usage.getAttribute("href")).toBe("/usage");
    usage.click();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("#native")?.hasAttribute("hidden")).toBe(
      true,
    );
  });

  it("adds accessible names and tooltips without replacing existing ones", () => {
    fixture();
    link().setAttribute("aria-label", "Open usage report");
    link().setAttribute("title", "Native tooltip");
    actions = installRunDetailActions();
    expect(link().getAttribute("aria-label")).toBe("Open usage report");
    expect(link().getAttribute("title")).toBe("Native tooltip");
    expect(link("workflow-file-link").getAttribute("aria-label")).toBe(
      "Workflow file",
    );
    expect(link("lockfile-link").getAttribute("title")).toBe("Lockfile");
  });

  it("restores original order, attributes, and hidden state exactly", () => {
    fixture();
    const original = document.body.innerHTML;
    actions = installRunDetailActions();
    actions.refresh();
    actions.refresh();
    expect(document.querySelectorAll(".ae-run-detail-actions")).toHaveLength(1);
    expect(document.querySelectorAll(".ae-run-detail-action")).toHaveLength(3);
    actions.remove();
    expect(document.body.innerHTML).toBe(original);
    actions.remove();
    expect(document.body.innerHTML).toBe(original);
  });

  it("does not hide other native content in the Run details group", () => {
    fixture('<a href="/other">Other details</a>');
    actions = installRunDetailActions();
    expect(document.querySelector("#native")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(document.querySelector('#native a[href="/other"]')).not.toBeNull();
  });

  it("reveals a formerly empty group if native content arrives", () => {
    fixture();
    actions = installRunDetailActions();
    document
      .querySelector("#native")
      ?.insertAdjacentHTML("beforeend", "<button>New native action</button>");
    actions.refresh();
    expect(document.querySelector("#native")?.hasAttribute("hidden")).toBe(
      false,
    );
  });

  it("restores an original hidden attribute value", () => {
    fixture();
    document.querySelector("#native")?.setAttribute("hidden", "until-found");
    actions = installRunDetailActions();
    actions.remove();
    expect(document.querySelector("#native")?.getAttribute("hidden")).toBe(
      "until-found",
    );
  });

  it("never fabricates absent links or enhances links outside Run details", () => {
    fixture();
    link("workflow-file-link").remove();
    link("lockfile-link").remove();
    actions = installRunDetailActions();
    expect(document.querySelectorAll(".ae-run-detail-action")).toHaveLength(1);
    actions.remove();
    document.querySelector("h2")!.textContent = "Something else";
    actions = installRunDetailActions();
    expect(document.querySelector(".ae-run-detail-actions")).toBeNull();
  });

  it("waits for a header and restores native content when it disappears", () => {
    fixture();
    const header = document.querySelector(".PageHeader-titleBar")!;
    header.remove();
    actions = installRunDetailActions();
    expect(link().closest("#native")).not.toBeNull();
    document.body.prepend(header);
    actions.refresh();
    expect(link().closest(".ae-run-detail-actions")).not.toBeNull();
    header.remove();
    actions.refresh();
    expect(link().closest("#native")).not.toBeNull();
    expect(document.querySelector("#native")?.hasAttribute("hidden")).toBe(
      false,
    );
  });

  it("reattaches the same anchors after a native title bar replacement", () => {
    fixture();
    actions = installRunDetailActions();
    const usage = link();
    document.querySelector(".PageHeader-titleBar")!.outerHTML =
      '<div class="PageHeader-titleBar"><h1>New header</h1></div>';
    actions.refresh();
    expect(link()).toBe(usage);
    expect(
      document.querySelector(".PageHeader-titleBar")?.contains(usage),
    ).toBe(true);
  });

  it("releases stale native groups and adopts replacement native anchors", () => {
    fixture();
    actions = installRunDetailActions();
    const oldGroup = document.querySelector("#native")!;
    const oldUsage = link();
    oldGroup.outerHTML = `<div id="native"><h3>Run details</h3>
      <a data-test-selector="usage-link" href="/new-usage"><svg></svg>Usage</a></div>`;
    actions.refresh();
    expect(link()).not.toBe(oldUsage);
    expect(link().getAttribute("href")).toBe("/new-usage");
    expect(oldGroup.contains(oldUsage)).toBe(true);
    expect(oldGroup.hasAttribute("hidden")).toBe(false);
    expect(document.querySelectorAll(".ae-run-detail-action")).toHaveLength(1);
  });

  it("drops stale moved anchors when a native subtree loses its markers", () => {
    fixture();
    actions = installRunDetailActions();
    const oldUsage = link();
    document.querySelector("#native")!.innerHTML = `<h2>Run details</h2>
      <a data-test-selector="usage-link" href="/replacement"><svg></svg>Usage</a>`;
    actions.refresh();
    expect(oldUsage.isConnected).toBe(false);
    expect(link().getAttribute("href")).toBe("/replacement");
    expect(document.querySelectorAll(".ae-run-detail-action")).toHaveLength(1);
    actions.remove();
    expect(
      document.querySelectorAll('a[data-test-selector="usage-link"]'),
    ).toHaveLength(1);
  });

  it("preserves preexisting extension-named attributes on cleanup", () => {
    fixture();
    document
      .querySelector("#native")!
      .setAttribute("data-ae-run-detail-empty", "original");
    const original = document.body.innerHTML;
    actions = installRunDetailActions();
    actions.remove();
    expect(document.body.innerHTML).toBe(original);
  });

  it("does not duplicate controls for responsive copies of native details", () => {
    fixture();
    const native = document.querySelector("#native")!;
    const copy = native.cloneNode(true);
    native.after(copy);
    actions = installRunDetailActions();
    actions.refresh();
    expect(document.querySelectorAll(".ae-run-detail-action")).toHaveLength(3);
    expect(copy.textContent).toContain("Workflow file");
    expect((copy as HTMLElement).hidden).toBe(true);
    actions.remove();
    expect((copy as HTMLElement).hidden).toBe(false);
  });

  it("hides Primer Run details groups once their links exist in the header", () => {
    fixture();
    const native = document.querySelector("#native")!;
    native.outerHTML = `<li data-component="ActionList.Group" id="native">
      <div><h3 data-component="ActionList.GroupHeading">Run details</h3></div>
      <ul>${native.querySelector("ul")!.innerHTML}</ul></li>`;
    const copy = document.querySelector("#native")!.cloneNode(true);
    document.querySelector("#native")!.after(copy);
    actions = installRunDetailActions();
    actions.refresh();
    expect(document.querySelector("#native")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect((copy as HTMLElement).hidden).toBe(true);
    expect(document.querySelectorAll(".ae-run-detail-action")).toHaveLength(3);
    actions.remove();
    expect(document.querySelector("#native")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect((copy as HTMLElement).hidden).toBe(false);
  });

  it("can refresh after removal without losing native anchors", () => {
    fixture();
    actions = installRunDetailActions();
    const usage = link();
    actions.remove();
    actions.refresh();
    expect(link()).toBe(usage);
    expect(usage.closest(".ae-run-detail-actions")).not.toBeNull();
  });
});
