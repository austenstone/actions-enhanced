import { runPathFor } from "./job-navigation";
import { currentLogLayout, currentRunView } from "./run-url";

export const prepareWorkspace = (doc: Document | HTMLElement, url: URL) => {
  if (!runPathFor(url.pathname)) return;
  const layout = doc.querySelector<HTMLElement>("split-page-layout");
  if (!layout || layout.hasAttribute("data-ae-workspace")) return;
  layout.setAttribute("data-ae-workspace", "");
  layout.setAttribute("data-ae-run-view", currentRunView(url));
  layout.setAttribute("data-ae-log-layout", currentLogLayout(url));
  layout.setAttribute(
    "data-ae-has-job",
    String(/\/job\/[1-9]\d*\/?$/.test(url.pathname)),
  );
};
