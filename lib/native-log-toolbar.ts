const stepSelector = "details.js-checks-log-details";
const groupSelector = "details.js-checks-log-group";
const toolbarSelector = '[data-actions-enhanced="native-log-toolbar"]';

const directSummary = (details: HTMLDetailsElement) =>
  Array.from(details.children).find(
    (element): element is HTMLElement => element.tagName === "SUMMARY",
  );

export const installNativeLogToolbar = (doc: Document, win: Window) => {
  let logs: HTMLElement | null = null;
  const bar = doc.createElement("div");
  bar.className = "ae-native-log-toolbar";
  bar.setAttribute("data-actions-enhanced", "native-log-toolbar");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Native log controls");

  const button = (label: string, title: string, action: () => void) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.className = "Button Button--small Button--invisible";
    element.textContent = label;
    element.title = title;
    element.addEventListener("click", action);
    bar.append(element);
    return element;
  };
  const details = (selector: string) =>
    Array.from(
      logs?.querySelectorAll<HTMLDetailsElement>(selector) ?? [],
    ).filter((element) => !element.closest("[hidden]"));
  const preserveScroll = (action: () => void) => {
    const positions: { element: Element; top: number; left: number }[] =
      Array.from(
        logs?.querySelectorAll<HTMLElement>(".js-full-logs-container") ?? [],
      ).map((element) => ({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      }));
    let element: Element | null = logs;
    while (element) {
      positions.push({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      });
      element = element.parentElement;
    }
    action();
    positions.forEach(({ element: target, top, left }) => {
      target.scrollTop = top;
      target.scrollLeft = left;
    });
  };
  const toggle = (selector: string, open: boolean) => {
    preserveScroll(() =>
      details(selector).forEach((element) => {
        if (element.open !== open) directSummary(element)?.click();
      }),
    );
    refresh();
  };
  const stepExpand = button(
    "Expand steps",
    "Expand steps using GitHub’s native controls (loads their logs)",
    () => toggle(stepSelector, true),
  );
  const stepCollapse = button(
    "Collapse steps",
    "Collapse steps using GitHub’s native controls",
    () => toggle(stepSelector, false),
  );
  const groupExpand = button("Expand groups", "Expand loaded log groups", () =>
    toggle(groupSelector, true),
  );
  const groupCollapse = button(
    "Collapse groups",
    "Collapse loaded log groups",
    () => toggle(groupSelector, false),
  );
  const scroll = (end: boolean) => {
    if (!logs) return;
    let element: HTMLElement | null =
      logs.querySelector<HTMLElement>(".js-full-logs-container") ?? logs;
    while (element && element !== doc.documentElement) {
      const { overflowY } = win.getComputedStyle(element);
      if (
        /^(auto|scroll)$/.test(overflowY) &&
        element.scrollHeight > element.clientHeight
      ) {
        element.scrollTop = end ? element.scrollHeight : 0;
        return;
      }
      element = element.parentElement;
    }
    const edge = end ? logs.lastElementChild : bar;
    edge?.scrollIntoView({ block: end ? "end" : "start", behavior: "instant" });
  };
  button("Top", "Go to the top of the native log pane", () => scroll(false));
  button("End", "Go to the end of the native log pane", () => scroll(true));
  const search = () =>
    logs?.querySelector<HTMLInputElement>(
      ".js-checks-log-search-input:not([disabled])",
    );
  const searchButton = button(
    "Search",
    "Focus GitHub’s native log search",
    () => {
      const input = search();
      input?.scrollIntoView({ block: "center", inline: "nearest" });
      input?.focus({ preventScroll: true });
    },
  );
  const nativeLink = (selector: string) =>
    logs?.querySelector<HTMLAnchorElement>(`a${selector}[href]`);
  const downloadSelector = ".js-steps-dropdown-log-archive";
  const rawSelector = ".js-steps-dropdown-raw-logs";
  const download = button(
    "Download",
    "Download log archive using GitHub’s native link",
    () => nativeLink(downloadSelector)?.click(),
  );
  const raw = button("Raw", "Open GitHub’s native raw logs", () =>
    nativeLink(rawSelector)?.click(),
  );
  const updateAvailability = () => {
    const steps = details(stepSelector).filter(directSummary);
    const groups = details(groupSelector).filter(directSummary);
    const set = (
      element: HTMLButtonElement,
      property: "disabled" | "hidden",
      value: boolean,
    ) => {
      if (element[property] !== value) element[property] = value;
    };
    set(stepExpand, "disabled", !steps.some((element) => !element.open));
    set(stepCollapse, "disabled", !steps.some((element) => element.open));
    set(groupExpand, "hidden", groups.length === 0);
    set(groupCollapse, "hidden", groups.length === 0);
    set(groupExpand, "disabled", !groups.some((element) => !element.open));
    set(groupCollapse, "disabled", !groups.some((element) => element.open));
    set(searchButton, "hidden", !search());
    set(download, "hidden", !nativeLink(downloadSelector));
    set(raw, "hidden", !nativeLink(rawSelector));
  };
  const onToggle = (event: Event) => {
    if (
      details(`${stepSelector}, ${groupSelector}`).some(
        (element) => element === event.target,
      )
    )
      updateAvailability();
  };
  const refresh = () => {
    const next = doc.querySelector<HTMLElement>(
      '[data-ae-workspace] section[aria-label="Check run summary"]:not([hidden]) .js-check-steps',
    );
    if (logs !== next) {
      logs?.removeEventListener("toggle", onToggle, true);
      bar.remove();
      logs = next;
      logs?.addEventListener("toggle", onToggle, true);
    }
    if (!logs) return;
    const existing = logs.querySelector(toolbarSelector);
    if (existing && existing !== bar) return;
    if (bar.parentElement !== logs) logs.prepend(bar);
    updateAvailability();
  };
  return {
    refresh,
    remove: () => {
      logs?.removeEventListener("toggle", onToggle, true);
      bar.remove();
      logs = null;
    },
  };
};
