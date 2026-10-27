import { installJobDetails } from "./job-details";
import { revealInSidebar, runPathFor } from "./job-navigation";
import { installLogLayout } from "./log-layout";
import { installNativeJobSteps } from "./native-job-steps";
import { currentRunView, jobHref, selectedJobPath } from "./run-url";
import { readNativeSections } from "./run-views";

const visitEvent = "actions-enhanced:visit";
const visitAttribute = "data-ae-visit";

export const requestNativeVisit = (url: URL, doc = document) => {
  const root = doc.documentElement;
  root.setAttribute(visitAttribute, url.href);
  doc.dispatchEvent(new Event(visitEvent));
  const accepted = root.getAttribute(visitAttribute) === "accepted";
  root.removeAttribute(visitAttribute);
  return accepted;
};

export const installWorkflowWorkspace = (doc: Document, win: Window) => {
  const layout = doc.querySelector<HTMLElement>("split-page-layout");
  const pane = layout?.querySelector<HTMLElement>(".PageLayout-pane");
  if (!layout || !pane || !layout.querySelector(".PageLayout-content"))
    return null;
  const run = runPathFor(win.location.pathname);
  if (!run) return null;
  const logLayout = installLogLayout(doc, win, layout, pane);
  const details = installJobDetails(doc, win, logLayout.controls);
  const steps = installNativeJobSteps(doc, win);
  const sections = new Map<string, { slot: HTMLElement; marker: Comment }>();
  const fittedGraphs = new WeakMap<HTMLElement, string>();
  const observedCanvases = new WeakSet<HTMLElement>();
  const graphResize = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const graph = target.closest<HTMLElement>("action-graph");
      if (graph) fitGraphWidth(graph);
    }
  });
  let graphFrame = 0;
  let graphTimer: ReturnType<typeof setTimeout> | undefined;
  const fitGraphWidth = (element: HTMLElement) => {
    const canvas = element.querySelector<HTMLElement>(
      '[data-target="action-graph.canvas"]',
    );
    const stages = element.querySelector<HTMLElement>(
      '[data-target="action-graph.stages"]',
    );
    const fit = element.querySelector<HTMLButtonElement>(
      '[data-target="action-graph.zoomFit"]',
    );
    if (
      !canvas ||
      !stages ||
      !fit ||
      !canvas.clientWidth ||
      !canvas.clientHeight
    )
      return;
    if (!observedCanvases.has(canvas)) {
      observedCanvases.add(canvas);
      graphResize.observe(canvas);
    }
    const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
    if (fittedGraphs.get(stages) === size) return;
    fittedGraphs.set(stages, size);
    fit.disabled = false;
    fit.click();
  };
  const selectedLinks = new Map<HTMLAnchorElement, string | null>();
  const selectedRows = new Map<
    HTMLElement,
    { active: string | null; classActive: boolean }
  >();
  let revealed = "";
  let destination: URL | null = null;
  let savedScroll = { x: win.scrollX, y: win.scrollY };
  let loading: HTMLElement | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const size = () => {
    layout.style.setProperty(
      "--ae-workspace-top",
      `${Math.max(16, pane.getBoundingClientRect().top)}px`,
    );
  };
  const finish = () => {
    clearTimeout(timeout);
    loading?.remove();
    loading = null;
    layout.querySelector(".PageLayout-content")?.removeAttribute("aria-busy");
  };
  const showLoading = (url: URL) => {
    finish();
    const content = layout.querySelector(".PageLayout-content");
    if (!content) return;
    content.setAttribute("aria-busy", "true");
    loading = doc.createElement("div");
    loading.className = "ae-job-loading flash";
    loading.setAttribute("data-actions-enhanced", "navigation-status");
    loading.setAttribute("role", "status");
    const message = doc.createElement("span");
    message.textContent = "Loading native job… ";
    const fallback = doc.createElement("a");
    fallback.href = url.href;
    fallback.textContent = "Open native page";
    fallback.setAttribute("data-ae-native-fallback", "");
    fallback.setAttribute("data-turbo", "false");
    loading.append(message, fallback);
    content.append(loading);
    timeout = setTimeout(() => {
      message.textContent = "Job navigation did not finish. ";
      loading?.setAttribute("role", "alert");
      content.removeAttribute("aria-busy");
    }, 30_000);
  };
  const refresh = () => {
    details.refresh();
    const nav = pane.querySelector('nav[aria-label="Workflow run"]');
    if (!nav) return;
    const url = new URL(win.location.href);
    if (runPathFor(url.pathname) !== run) return;
    const view = currentRunView(url);
    layout.setAttribute("data-ae-workspace", "");
    layout.setAttribute("data-ae-run-view", view);
    logLayout.apply();
    details.refresh();
    steps.refresh(pane);
    size();
    const container =
      Array.from(pane.children).find((element) => element.contains(nav)) ?? nav;
    const experience = doc.getElementById("ae-run-experience");
    if (experience && pane.firstElementChild !== experience)
      pane.prepend(experience);
    const selected = selectedJobPath(url);
    nav.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
      if (link.closest("[data-actions-enhanced]")) return;
      const href = new URL(link.href, url);
      if (
        href.origin !== url.origin ||
        runPathFor(href.pathname) !== run ||
        !(
          href.pathname === run ||
          /\/(?:job|attempts)\/\d+\/?$/.test(href.pathname)
        )
      )
        return;
      const active = selected
        ? href.pathname === selected
        : !/\/job\//.test(href.pathname);
      if (!selectedLinks.has(link))
        selectedLinks.set(link, link.getAttribute("aria-current"));
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      const row = link.closest<HTMLElement>(".ActionListItem, li");
      if (
        row &&
        Array.from(row.querySelectorAll('a[href*="/job/"]')).filter(
          (anchor) => !anchor.closest("[data-actions-enhanced]"),
        ).length <= 1
      ) {
        if (!selectedRows.has(row))
          selectedRows.set(row, {
            active: row.getAttribute("data-active"),
            classActive: row.classList.contains("ActionListItem--navActive"),
          });
        if (active) row.setAttribute("data-active", "true");
        else row.removeAttribute("data-active");
        row.classList.toggle("ActionListItem--navActive", active);
      }
      if (
        active &&
        selected &&
        view === "summary" &&
        selected !== revealed &&
        container instanceof HTMLElement
      ) {
        revealInSidebar(container, row ?? link, 0);
        revealed = selected;
      }
    });
    const native = readNativeSections(doc, url);
    (["graph"] as const).forEach((kind) => {
      const element = native[kind];
      let section = sections.get(kind);
      if (!section && element && !/\/job\/\d+\/?$/.test(url.pathname)) {
        const marker = doc.createComment(
          `Actions Enhanced native ${kind} location`,
        );
        element.before(marker);
        const slot =
          element.closest<HTMLElement>("[data-ae-native-section]") ??
          doc.createElement("section");
        slot.setAttribute("data-ae-native-section", kind);
        if (!slot.contains(element)) slot.append(element);
        section = { slot, marker };
        sections.set(kind, section);
      }
      if (section) {
        if (experience) {
          if (experience.nextElementSibling !== section.slot)
            experience.after(section.slot);
        } else if (section.slot.parentElement !== pane) {
          container.before(section.slot);
        }
        section.slot.hidden = view !== kind;
        if (view === "graph") {
          win.cancelAnimationFrame(graphFrame);
          clearTimeout(graphTimer);
          const slot = section.slot;
          graphFrame = win.requestAnimationFrame(() => {
            graphTimer = setTimeout(() => fitGraphWidth(slot), 150);
          });
        }
      }
    });
  };
  const beforeVisit = (event: Event) => {
    if (
      !(event instanceof CustomEvent) ||
      typeof event.detail?.url !== "string"
    )
      return;
    destination = new URL(event.detail.url, win.location.href);
    savedScroll = { x: win.scrollX, y: win.scrollY };
  };
  const afterLoad = () => {
    finish();
    refresh();
    details.revealStep();
    if (destination && runPathFor(destination.pathname) === run)
      win.scrollTo(savedScroll.x, savedScroll.y);
    destination = null;
  };
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (
      !link ||
      link.target ||
      link.hasAttribute("download") ||
      link.hasAttribute("data-ae-native-fallback")
    )
      return;
    const next = new URL(link.href, win.location.href);
    if (
      next.origin !== win.location.origin ||
      runPathFor(next.pathname) !== run
    )
      return;
    const isJob = /\/job\/\d+\/?$/.test(next.pathname);
    if (
      isJob &&
      !next.searchParams.has("ae_step") &&
      link.closest('nav[aria-label="Workflow run"]') &&
      !link.closest("[data-actions-enhanced]")
    ) {
      const disclosure = link
        .closest("li")
        ?.querySelector<HTMLDetailsElement>(":scope > .ae-native-job-steps");
      if (disclosure) {
        event.preventDefault();
        event.stopImmediatePropagation();
        disclosure.open = !disclosure.open;
        return;
      }
    }
    const isView = !!link.closest(
      '[aria-label="Run views"], .ae-run-view-description',
    );
    if (!isJob && !isView) return;
    const url = new URL(
      isJob && !isView
        ? logLayout.openUrl(
            new URL(jobHref(next.href, new URL(win.location.href))),
          )
        : next.href,
    );
    if (isView) {
      const currentLayout = new URL(win.location.href).searchParams.get(
        "ae_layout",
      );
      if (currentLayout) url.searchParams.set("ae_layout", currentLayout);
      else url.searchParams.delete("ae_layout");
    }
    if (next.searchParams.has("ae_step")) {
      url.searchParams.set("ae_step", next.searchParams.get("ae_step") ?? "");
      url.searchParams.delete("ae_tab");
    }
    const view = currentRunView(url);
    const localView =
      isView && (url.pathname === win.location.pathname || sections.has(view));
    const localStep =
      isJob &&
      next.searchParams.has("ae_step") &&
      selectedJobPath(new URL(win.location.href)) === next.pathname &&
      !!layout.querySelector(
        'section[aria-label="Check run summary"]:not([hidden])',
      );
    if (localView || localStep) {
      event.preventDefault();
      event.stopImmediatePropagation();
      win.history.pushState(win.history.state, "", url);
      win.dispatchEvent(new PopStateEvent("popstate"));
      refresh();
      if (localStep) details.revealStep();
    } else {
      destination = url;
      savedScroll = { x: win.scrollX, y: win.scrollY };
      // Turbo pushes history synchronously, so reopen on the current entry first.
      if (isJob && !isView) {
        win.history.replaceState(
          win.history.state,
          "",
          logLayout.openUrl(new URL(win.location.href)),
        );
        logLayout.apply();
      }
      if (!requestNativeVisit(url, doc)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showLoading(url);
    }
  };
  const modified = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      (!event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.button !== 1)
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (!link || link.closest('[aria-label="Run views"]')) return;
    const target = new URL(link.href, win.location.href);
    if (
      target.origin !== win.location.origin ||
      runPathFor(target.pathname) !== run ||
      !/\/job\/\d+\/?$/.test(target.pathname)
    )
      return;
    const original = link.getAttribute("href");
    const href = jobHref(link.href, new URL(win.location.href));
    link.href = href;
    win.setTimeout(() => {
      if (original !== null && link.href === href)
        link.setAttribute("href", original);
    }, 0);
  };
  doc.addEventListener("turbo:before-visit", beforeVisit);
  doc.addEventListener("click", click, true);
  doc.addEventListener("click", modified, true);
  doc.addEventListener("auxclick", modified, true);
  win.addEventListener("popstate", refresh);
  doc.addEventListener("turbo:load", afterLoad);
  win.addEventListener("resize", size);
  refresh();
  details.revealStep();
  return {
    pane,
    refresh,
    remove: () => {
      graphResize.disconnect();
      win.cancelAnimationFrame(graphFrame);
      clearTimeout(graphTimer);
      finish();
      details.remove();
      steps.remove();
      logLayout.remove();
      doc.removeEventListener("turbo:before-visit", beforeVisit);
      doc.removeEventListener("click", click, true);
      doc.removeEventListener("click", modified, true);
      doc.removeEventListener("auxclick", modified, true);
      win.removeEventListener("popstate", refresh);
      doc.removeEventListener("turbo:load", afterLoad);
      win.removeEventListener("resize", size);
      layout.removeAttribute("data-ae-workspace");
      layout.removeAttribute("data-ae-run-view");
      layout.style.removeProperty("--ae-workspace-top");
      selectedLinks.forEach((value, link) => {
        if (value === null) link.removeAttribute("aria-current");
        else link.setAttribute("aria-current", value);
      });
      selectedRows.forEach((value, row) => {
        if (value.active === null) row.removeAttribute("data-active");
        else row.setAttribute("data-active", value.active);
        row.classList.toggle("ActionListItem--navActive", value.classActive);
      });
      sections.forEach(({ slot, marker }) => {
        if (marker.isConnected) marker.replaceWith(...slot.childNodes);
        slot.remove();
      });
    },
  };
};
