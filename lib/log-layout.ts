import { currentLogLayout, type LogLayout } from "./run-url";

type OpenLayout = Exclude<LogLayout, "closed" | "fullscreen">;
type Choice = Exclude<LogLayout, "closed">;

const icons = {
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  side: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M8 2.5v11"/>',
  below:
    '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M1.5 8h13"/>',
  maximized:
    '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 5.5h7v5h-7z" fill="currentColor"/>',
  fullscreen:
    '<path d="M1.75 5.5v-3.75h3.75M10.5 1.75h3.75v3.75M14.25 10.5v3.75h-3.75M5.5 14.25h-3.75v-3.75"/>',
  exitFullscreen:
    '<path d="M5.5 1.75v3.75h-3.75M14.25 5.5h-3.75v-3.75M10.5 14.25v-3.75h3.75M1.75 10.5h3.75v3.75"/>',
};
const labels: Record<Choice, string> = {
  below: "Logs below jobs",
  side: "Logs beside jobs",
  maximized: "Maximize logs",
  fullscreen: "Fullscreen logs",
};

const icon = (doc: Document, paths: string) => {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "octicon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths;
  return svg;
};

const iconButton = (doc: Document, label: string, paths: string) => {
  const button = doc.createElement("button");
  button.type = "button";
  button.className =
    "Button Button--iconOnly Button--invisible Button--small ae-log-layout-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(doc, paths));
  return button;
};

export const installLogLayout = (
  doc: Document,
  win: Window,
  layout: HTMLElement,
  pane: HTMLElement,
) => {
  let open: OpenLayout = "side";
  let split: "side" | "below" = "side";
  const close = iconButton(doc, "Close logs", icons.close);
  close.classList.add("ae-log-close");
  const group = doc.createElement("div");
  group.className = "UnderlineNav-actions ae-log-layout";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Log layout");
  const choices = (["below", "side", "maximized", "fullscreen"] as const).map(
    (choice) => {
      const button = iconButton(doc, labels[choice], icons[choice]);
      button.setAttribute("data-ae-log-layout-choice", choice);
      if (choice === "fullscreen")
        button.title = `${labels[choice]} (Esc to exit)`;
      group.append(button);
      return { choice, button };
    },
  );
  const current = () => currentLogLayout(new URL(win.location.href));
  const apply = () => {
    const value = current();
    if (value === "side" || value === "below") split = value;
    if (value !== "closed" && value !== "fullscreen") open = value;
    if (layout.getAttribute("data-ae-log-layout") !== value)
      layout.setAttribute("data-ae-log-layout", value);
    choices.forEach(({ choice, button }) => {
      const pressed = String(choice === value);
      if (button.getAttribute("aria-pressed") === pressed) return;
      button.setAttribute("aria-pressed", pressed);
      if (choice === "fullscreen")
        button.replaceChildren(
          icon(
            doc,
            pressed === "true" ? icons.exitFullscreen : icons.fullscreen,
          ),
        );
    });
  };
  const withLayout = (url: URL, value: LogLayout) => {
    if (value === "side") url.searchParams.delete("ae_layout");
    else url.searchParams.set("ae_layout", value);
    return url;
  };
  let saved: { content: Element; top: number } | null = null;
  const set = (value: LogLayout) => {
    const content = layout.querySelector(".PageLayout-content");
    const leaving = current() === "closed";
    if (value === "closed" && content)
      saved = { content, top: content.scrollTop };
    const url = withLayout(new URL(win.location.href), value);
    win.history.replaceState(win.history.state, "", url);
    apply();
    win.dispatchEvent(new PopStateEvent("popstate"));
    if (leaving && saved && saved.content === content)
      content.scrollTop = saved.top;
    if (value !== "closed") saved = null;
  };
  close.addEventListener("click", () => {
    set("closed");
    pane
      .querySelector<HTMLElement>('.ae-run-views a[aria-current="page"], nav a')
      ?.focus({ preventScroll: true });
  });
  choices.forEach(({ choice, button }) =>
    button.addEventListener("click", () => {
      const value = current();
      if (choice !== value) set(choice);
      else if (choice === "fullscreen") set(open);
      else if (choice === "maximized") set(split);
    }),
  );
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (current() !== "fullscreen") return;
    event.preventDefault();
    set(open);
  };
  doc.addEventListener("keydown", keydown);
  apply();
  return {
    controls: { start: close, end: group },
    apply,
    openUrl: (url: URL) =>
      current() === "closed" ? withLayout(url, open) : url,
    remove: () => {
      doc.removeEventListener("keydown", keydown);
      layout.removeAttribute("data-ae-log-layout");
    },
  };
};
