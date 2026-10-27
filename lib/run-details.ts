const sections = [
  {
    view: "run-summary",
    selector:
      '[role="region"][aria-label="Workflow run summary"], job-summaries',
    empty: "No summary is available for this run.",
  },
  {
    view: "annotations",
    selector: '[role="region"][aria-label="Annotations"]',
    empty: "No annotations for this run.",
  },
  {
    view: "artifacts",
    selector: '[role="region"][aria-label="Artifacts"]',
    empty: "No artifacts for this run.",
  },
] as const;

export const transferRunDetails = (
  doc: Document,
  source: Element,
  pane: Element,
) => {
  if (
    !source.querySelector(
      '[role="region"][aria-label="Workflow run summary"]',
    ) &&
    !pane.querySelector('[data-ae-native-section="run-summary"]')
  )
    return;
  for (const { view, selector, empty } of sections) {
    const existing = pane.querySelector<HTMLElement>(
      `[data-ae-native-section="${view}"]`,
    );
    const slot = existing ?? doc.createElement("section");
    const incoming = Array.from(source.querySelectorAll(selector));
    if (existing && !incoming.length) continue;
    if (incoming.length)
      slot.querySelector("[data-ae-section-empty]")?.remove();
    slot.setAttribute("data-ae-native-section", view);
    slot.setAttribute(
      "aria-label",
      view === "run-summary" ? "Run summary" : `Run ${view}`,
    );
    slot.tabIndex = -1;
    if (!existing) slot.hidden = true;
    incoming.forEach((element) => slot.append(element));
    if (!slot.children.length) {
      const message = doc.createElement("p");
      message.className = "color-fg-muted";
      message.setAttribute("data-ae-section-empty", "");
      message.textContent = empty;
      slot.append(message);
    }
    if (!existing) pane.append(slot);
  }
};

export const installRunDetails = (doc: Document, win: Window) => {
  const originals = new Map<Element, Comment>();
  const slots = new Set<Element>();
  const prompt = doc.createElement("p");
  prompt.className = "ae-run-detail-empty color-fg-muted";
  prompt.setAttribute("data-actions-enhanced", "job-selection-empty");
  prompt.textContent = "Select a job to view its logs and details.";
  const refresh = () => {
    const layout = doc.querySelector("[data-ae-workspace]");
    const pane = layout?.querySelector(".PageLayout-pane");
    const content = layout?.querySelector(".PageLayout-content");
    if (!pane || !content) return;
    if (
      content.querySelector(
        '[role="region"][aria-label="Workflow run summary"]',
      ) ||
      pane.querySelector('[data-ae-native-section="run-summary"]')
    ) {
      for (const { selector } of sections) {
        content.querySelectorAll(selector).forEach((element) => {
          if (originals.has(element)) return;
          const marker = doc.createComment(
            "Actions Enhanced run detail location",
          );
          element.before(marker);
          originals.set(element, marker);
        });
      }
      transferRunDetails(doc, content, pane);
    }
    const view = new URL(win.location.href).searchParams.get("ae_view");
    for (const { view: name } of sections) {
      const slot = pane.querySelector<HTMLElement>(
        `[data-ae-native-section="${name}"]`,
      );
      if (!slot) continue;
      slots.add(slot);
      slot.hidden = view !== name;
    }
    const hasJob = !!content.querySelector(
      'section[aria-label="Check run summary"]:not([hidden])',
    );
    if (hasJob) prompt.remove();
    else if (!prompt.isConnected) content.append(prompt);
    layout?.setAttribute("data-ae-has-job", String(hasJob));
  };
  win.addEventListener("popstate", refresh);
  doc.addEventListener("turbo:load", refresh);
  return {
    refresh,
    remove: () => {
      originals.forEach((marker, element) => {
        if (marker.isConnected) marker.replaceWith(element);
      });
      const content = doc.querySelector(
        "[data-ae-workspace] .PageLayout-content",
      );
      slots.forEach((slot) => {
        if (content) while (slot.firstChild) content.append(slot.firstChild);
        slot.remove();
      });
      doc
        .querySelector("[data-ae-has-job]")
        ?.removeAttribute("data-ae-has-job");
      prompt.remove();
      win.removeEventListener("popstate", refresh);
      doc.removeEventListener("turbo:load", refresh);
    },
  };
};
