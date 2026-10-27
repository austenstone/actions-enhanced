import { disclosurePath } from "./disclosure-icon";
import { jobStepHref, requestJobSteps } from "./job-steps";
import { jobHref } from "./run-url";

export const installNativeJobSteps = (doc: Document, win: Window) => {
  const disclosures = new Map<HTMLAnchorElement, HTMLDetailsElement>();
  const refresh = (pane: HTMLElement) => {
    const current = new URL(win.location.href);
    pane
      .querySelectorAll<HTMLAnchorElement>(".ae-native-step-link")
      .forEach((anchor) => {
        const target = new URL(anchor.href);
        const selected =
          current.pathname === target.pathname ||
          current.searchParams.get("ae_job") ===
            target.pathname.split("/").at(-1);
        if (
          selected &&
          current.searchParams.get("ae_step") ===
            target.searchParams.get("ae_step")
        )
          anchor.setAttribute("aria-current", "step");
        else anchor.removeAttribute("aria-current");
      });
    const nav = pane.querySelector('nav[aria-label="Workflow run"]');
    const links = Array.from(
      nav?.querySelectorAll<HTMLAnchorElement>('a[href*="/job/"]') ?? [],
    ).filter((link) => !link.closest("[data-actions-enhanced]"));
    for (const [link, disclosure] of disclosures) {
      const attempt =
        new URL(
          jobHref(link.href, new URL(win.location.href)),
        ).searchParams.get("attempt") ?? "";
      if (
        !links.includes(link) ||
        !disclosure.isConnected ||
        disclosure.dataset.attempt !== attempt
      ) {
        disclosure.remove();
        disclosures.delete(link);
      }
    }
    for (const link of links) {
      if (disclosures.has(link)) continue;
      const row = link.closest("li");
      if (!row) continue;
      const disclosure = doc.createElement("details");
      disclosure.className = "ae-native-job-steps";
      disclosure.dataset.attempt =
        new URL(
          jobHref(link.href, new URL(win.location.href)),
        ).searchParams.get("attempt") ?? "";
      disclosure.setAttribute("data-actions-enhanced", "job-steps");
      const toggle = doc.createElement("summary");
      toggle.className = "color-fg-muted text-small";
      toggle.innerHTML = `<svg class="octicon octicon-chevron-down" data-component="Octicon" aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="${disclosurePath}"/></svg>`;
      toggle.setAttribute(
        "aria-label",
        `Steps for ${link.querySelector('[data-component="ActionList.Item.Label"]')?.textContent?.trim() || link.textContent?.trim()}`,
      );
      const content = doc.createElement("div");
      disclosure.append(toggle, content);
      let loadedAt = 0;
      let loading = false;
      const load = async () => {
        if (Date.now() - loadedAt < 15_000 || loading || !disclosure.open)
          return;
        loading = true;
        content.textContent = "Loading steps…";
        content.setAttribute("role", "status");
        const url = new URL(jobHref(link.href, new URL(win.location.href)));
        try {
          const steps = await requestJobSteps(url);
          if (!disclosure.isConnected) return;
          const list = doc.createElement("ul");
          list.className = "ae-native-step-list";
          for (const step of steps) {
            if (step.status === "skipped") continue;
            const item = doc.createElement("li");
            const anchor = doc.createElement("a");
            anchor.href = jobStepHref(url, step.number);
            anchor.className = "ae-native-step-link";
            anchor.title = `${step.name}: ${step.status}`;
            const name = doc.createElement("span");
            name.className = "ae-native-step-name";
            name.textContent = step.name;
            const status = doc.createElement("span");
            status.className = "color-fg-muted text-small";
            status.textContent = step.duration || step.status;
            const icon = doc.createElement("span");
            icon.className = `ae-native-step-status ae-step-${step.status}`;
            icon.setAttribute("aria-label", step.status);
            icon.textContent =
              step.status === "success"
                ? "✓"
                : step.status === "failure"
                  ? "×"
                  : step.status === "skipped"
                    ? "−"
                    : "○";
            anchor.append(icon, name, status);
            const current = new URL(win.location.href);
            if (
              current.searchParams.get("ae_step") === String(step.number) &&
              (current.pathname === url.pathname ||
                current.searchParams.get("ae_job") ===
                  url.pathname.split("/").at(-1))
            ) {
              anchor.setAttribute("aria-current", "step");
            }
            item.append(anchor);
            list.append(item);
          }
          content.replaceChildren(list);
          content.removeAttribute("role");
          loadedAt = Date.now();
        } catch (failure) {
          if (!disclosure.isConnected) return;
          const message = doc.createElement("span");
          message.setAttribute("role", "alert");
          message.textContent =
            failure instanceof Error
              ? failure.message
              : "Unable to load job steps.";
          const retry = doc.createElement("button");
          retry.type = "button";
          retry.className = "btn-link text-small";
          retry.textContent = "Retry";
          retry.addEventListener("click", () => void load());
          content.replaceChildren(message, retry);
        } finally {
          loading = false;
        }
      };
      disclosure.addEventListener("toggle", () => void load());
      row.append(disclosure);
      disclosures.set(link, disclosure);
    }
  };
  return {
    refresh,
    remove: () => {
      disclosures.forEach((element) => element.remove());
      disclosures.clear();
    },
  };
};
