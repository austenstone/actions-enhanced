import "./style.css";
import "./run-details.css";
import "./run-detail-actions.css";
import "../../lib/job-inspector.css";
import "../../lib/native-job-steps.css";
import { createRoot } from "react-dom/client";
import { createIntegratedUi } from "wxt/utils/content-script-ui/integrated";
import { defineContentScript } from "wxt/utils/define-content-script";
import { readBreadcrumbs } from "../../lib/breadcrumbs";
import { readSurface } from "../../lib/github";
import { runPathFor } from "../../lib/job-navigation";
import { installRunDetailActions } from "../../lib/run-detail-actions";
import { installRunDetails } from "../../lib/run-details";
import { installWorkflowWorkspace } from "../../lib/workflow-workspace";
import { prepareWorkspace } from "../../lib/workspace-prelayout";
import { App } from "./App";
import { RunExperience } from "./RunExperience";
import { RunHeader, readRunHeader } from "./RunHeader";

export default defineContentScript({
  matches: ["https://github.com/*"],
  runAt: "document_start",
  main(ctx) {
    if (window.top !== window) return;
    prepareWorkspace(document, new URL(location.href));
    const readEnhancedSurface = () => {
      const next = readSurface(document, new URL(location.href));
      return next?.kind === "jobs" ? next : null;
    };
    let surface = readEnhancedSurface();
    let fingerprint = "";
    let timer: number | undefined;
    let experienceAnchor: HTMLElement | null = null;
    let headerAnchor: HTMLElement | null = null;
    let nativeHeader: HTMLElement | null = null;
    let workspace: ReturnType<typeof installWorkflowWorkspace> = null;
    let workspaceLayout: Element | null = null;
    let workspaceRun = "";
    const runDetails = installRunDetails(document, window);
    const runDetailActions = installRunDetailActions(document);
    const syncWorkspace = () => {
      const layout = document.querySelector("split-page-layout");
      const run = surface?.kind === "jobs" ? runPathFor(location.pathname) : "";
      if (workspace && (workspaceRun !== run || workspaceLayout !== layout)) {
        workspace.remove();
        workspace = null;
      }
      if (!workspace && run) {
        workspace = installWorkflowWorkspace(document, window);
        workspaceLayout = layout;
        workspaceRun = run;
      }
      if (workspace && workspaceLayout !== layout) {
        workspace.refresh();
        workspaceLayout = layout;
      }
      runDetails.refresh();
      runDetailActions.refresh();
    };
    const headerUi = createIntegratedUi(ctx, {
      position: "inline",
      anchor: () => headerAnchor,
      append: "before",
      onMount(container) {
        container.setAttribute("data-actions-enhanced", "run-header");
        const root = createRoot(container);
        root.render(<RunHeader />);
        nativeHeader?.setAttribute("data-ae-compact-header", "");
        return root;
      },
      onRemove(root) {
        root?.unmount();
        nativeHeader?.removeAttribute("data-ae-compact-header");
      },
    });
    const syncHeader = () => {
      const next =
        surface?.kind === "jobs" &&
        readRunHeader(document, new URL(location.href))?.links.length
          ? document.querySelector<HTMLElement>(
              "page-header .PageHeader-titleWrap",
            )
          : null;
      if (!next || next !== headerAnchor || !headerUi.wrapper.isConnected) {
        headerUi.remove();
        headerAnchor = next;
        nativeHeader = next?.closest("page-header") ?? null;
        if (next) headerUi.mount();
      } else {
        headerUi.mounted?.render(<RunHeader />);
      }
    };
    const ui = createIntegratedUi(ctx, {
      position: "inline",
      anchor: () => surface?.anchor ?? null,
      append: "before",
      onMount(container) {
        container.setAttribute("data-actions-enhanced", "");
        const wrapper = document.createElement("div");
        container.append(wrapper);
        const root = createRoot(wrapper);
        if (surface && !workspace)
          root.render(
            <App
              key={runPathFor(location.pathname) || location.pathname}
              surface={surface}
            />,
          );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    const experience = createIntegratedUi(ctx, {
      position: "inline",
      anchor: () => experienceAnchor,
      append: "before",
      onMount(container) {
        container.setAttribute("data-actions-enhanced", "run-experience");
        container.id = "ae-run-experience";
        container.setAttribute("data-turbo-permanent", "");
        const wrapper = document.createElement("div");
        container.append(wrapper);
        const root = createRoot(wrapper);
        if (surface?.kind === "jobs")
          root.render(
            <RunExperience
              key={runPathFor(location.pathname)}
              surface={surface}
            />,
          );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    const syncExperience = (render = true) => {
      const content = document.querySelector<HTMLElement>(
        "split-page-layout .PageLayout-content",
      );
      const anchor =
        surface?.kind === "jobs"
          ? workspace
            ? surface.anchor
            : (Array.from(content?.children ?? []).find(
                (element): element is HTMLElement =>
                  element instanceof HTMLElement &&
                  !element.hasAttribute("data-actions-enhanced"),
              ) ??
              document.querySelector<HTMLElement>(
                '[role="region"][aria-label="Workflow run summary"], section[aria-label="Check run summary"], [data-ae-run-content]',
              ))
          : null;
      if (!anchor) {
        experience.remove();
        experienceAnchor = null;
      } else if (
        !experience.wrapper.isConnected ||
        (!workspace && experienceAnchor !== anchor)
      ) {
        experience.remove();
        experienceAnchor = anchor;
        experience.mount();
      } else if (surface && render) {
        experienceAnchor = anchor;
        experience.mounted?.render(
          <RunExperience
            key={runPathFor(location.pathname)}
            surface={surface}
          />,
        );
      }
    };

    const sync = () => {
      timer = undefined;
      if (ctx.isInvalid) return;
      const next = readEnhancedSurface();
      const nextFingerprint = JSON.stringify([
        location.href,
        next?.items,
        next?.kind === "jobs"
          ? readBreadcrumbs(document, new URL(location.href))
          : [],
        next?.kind === "jobs"
          ? readRunHeader(document, new URL(location.href))
          : null,
      ]);
      if (!next) {
        if (
          workspace &&
          workspaceRun === runPathFor(location.pathname) &&
          experience.wrapper.isConnected &&
          document.querySelector("split-page-layout .PageLayout-pane")
        )
          return;
        ui.remove();
        surface = null;
        syncWorkspace();
        syncHeader();
        fingerprint = "";
        syncExperience();
        return;
      }
      if (
        !ui.wrapper.isConnected ||
        surface?.kind !== next.kind ||
        (!workspace && surface?.anchor !== next.anchor)
      ) {
        ui.remove();
        surface = next;
        syncWorkspace();
        workspace?.refresh();
        syncHeader();
        fingerprint = nextFingerprint;
        ui.mount();
        syncExperience();
      } else if (
        fingerprint !== nextFingerprint ||
        surface?.targets.some(
          (target, index) => target.element !== next.targets[index]?.element,
        )
      ) {
        surface = next;
        syncWorkspace();
        workspace?.refresh();
        syncHeader();
        fingerprint = nextFingerprint;
        ui.mounted?.render(
          workspace ? null : (
            <App
              key={runPathFor(location.pathname) || location.pathname}
              surface={next}
            />
          ),
        );
        syncExperience();
      } else if (surface?.kind === "jobs") {
        syncWorkspace();
        workspace?.refresh();
        const anchor = document.querySelector(
          "page-header .PageHeader-titleWrap",
        );
        if (
          headerAnchor !== anchor ||
          (anchor && !headerUi.wrapper.isConnected)
        )
          syncHeader();
        syncExperience(false);
      }
    };
    const schedule = () => {
      prepareWorkspace(document, new URL(location.href));
      if (timer !== undefined) return;
      timer = ctx.setTimeout(sync, 0);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "aria-label", "class", "datetime"],
    });
    ctx.addEventListener(document, "turbo:load", schedule);
    ctx.addEventListener(document, "turbo:render", schedule);
    ctx.addEventListener(window, "wxt:locationchange", schedule);
    ctx.addEventListener(window, "popstate", schedule);
    ctx.onInvalidated(() => {
      observer.disconnect();
      clearTimeout(timer);
      ui.remove();
      experience.remove();
      headerUi.remove();
      runDetails.remove();
      runDetailActions.remove();
      workspace?.remove();
    });
    sync();
  },
});
