import { defineContentScript } from "wxt/utils/define-content-script";
import { runPathFor } from "../lib/job-navigation";
import { transferRunDetails } from "../lib/run-details";
import { prepareWorkspace } from "../lib/workspace-prelayout";

type NativeTurbo = {
  visit: (url: string, options: { action: "advance" }) => void;
};
const isTurbo = (value: unknown): value is NativeTurbo =>
  typeof value === "object" &&
  value !== null &&
  "visit" in value &&
  typeof value.visit === "function";

export const installNativeNavigation = (doc: Document, win: Window) => {
  let destination: URL | null = null;
  const beforeVisit = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail?.url === "string")
      destination = new URL(event.detail.url, win.location.href);
  };
  const beforeRender = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (
      typeof detail !== "object" ||
      detail === null ||
      !("newBody" in detail) ||
      !(detail.newBody instanceof HTMLElement) ||
      !("render" in detail)
    )
      return;
    const layout = doc.querySelector("[data-ae-workspace]");
    const current = layout?.querySelector(".PageLayout-content");
    const incoming = detail.newBody.querySelector(".PageLayout-content");
    const run = runPathFor(win.location.pathname);
    const next = destination ?? new URL(win.location.href);
    if (next.origin === win.location.origin)
      prepareWorkspace(detail.newBody, next);
    if (
      !layout ||
      !current ||
      !incoming ||
      !run ||
      next.origin !== win.location.origin ||
      runPathFor(next.pathname) !== run
    )
      return;
    const incomingMobileNavigation = detail.newBody.querySelector(
      "page-header .PageHeader-navigation",
    );
    // Use Turbo's public scoped renderer, never detach/reuse a running log renderer.
    detail.render = () => {
      const view = next.searchParams.get("ae_view");
      const pane = layout.querySelector(".PageLayout-pane");
      if (
        pane &&
        ["graph", "run-summary", "annotations", "artifacts"].includes(
          view ?? "",
        ) &&
        !/\/job\/\d+\/?$/.test(next.pathname)
      ) {
        transferRunDetails(doc, incoming, pane);
        for (const [kind, selector] of [
          [
            "graph",
            '[role="region"][aria-label="Workflow run graph"], action-graph',
          ],
        ] as const) {
          if (layout.querySelector(`[data-ae-native-section="${kind}"]`))
            continue;
          const element = incoming.querySelector(selector);
          if (!element) continue;
          const slot = doc.createElement("section");
          slot.setAttribute("data-ae-native-section", kind);
          slot.append(element);
          pane.append(slot);
        }
      } else {
        if (next.searchParams.get("ae_tab") === "annotations")
          incoming.setAttribute("data-ae-detail-tab", "annotations");
        current.replaceWith(incoming);
        const currentMobileNavigation = doc.querySelector(
          "page-header .PageHeader-navigation",
        );
        if (currentMobileNavigation && incomingMobileNavigation)
          currentMobileNavigation.replaceWith(incomingMobileNavigation);
      }
    };
  };
  const loaded = () => {
    destination = null;
  };
  const visit = () => {
    const root = doc.documentElement;
    const href = root.getAttribute("data-ae-visit");
    if (!href || !URL.canParse(href, win.location.href)) return;
    const next = new URL(href, win.location.href);
    const run = runPathFor(win.location.pathname);
    if (
      !run ||
      next.origin !== win.location.origin ||
      runPathFor(next.pathname) !== run
    )
      return;
    const turbo: unknown = Reflect.get(win, "Turbo");
    if (!isTurbo(turbo)) return;
    try {
      turbo.visit(next.href, { action: "advance" });
      root.setAttribute("data-ae-visit", "accepted");
    } catch (error) {
      console.error(
        "[Actions Enhanced] Native soft navigation failed. Keeping the native link.",
        error,
      );
    }
  };
  doc.addEventListener("turbo:before-visit", beforeVisit);
  doc.addEventListener("turbo:before-render", beforeRender);
  doc.addEventListener("turbo:load", loaded);
  doc.addEventListener("actions-enhanced:visit", visit);
  const remove = () => {
    doc.removeEventListener("turbo:before-visit", beforeVisit);
    doc.removeEventListener("turbo:before-render", beforeRender);
    doc.removeEventListener("turbo:load", loaded);
    doc.removeEventListener("actions-enhanced:visit", visit);
    doc.removeEventListener("actions-enhanced:reset-native-navigation", remove);
  };
  doc.addEventListener("actions-enhanced:reset-native-navigation", remove, {
    once: true,
  });
  return remove;
};

export default defineContentScript({
  matches: ["https://github.com/*"],
  world: "MAIN",
  main() {
    document.dispatchEvent(
      new Event("actions-enhanced:reset-native-navigation"),
    );
    installNativeNavigation(document, window);
  },
});
