import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  type Item,
  type Status,
  type Surface,
  statusLabels,
} from "../../lib/github";
import "./shared-job-controls.css";

type GroupBy = "none" | "state";
type NativeFilterStatus = Status | "all" | null;

const nativeStatusForLabel = (label: string): NativeFilterStatus => {
  const normalized = label.toLowerCase();
  if (/^(?:all|all states|all statuses|all except skipped)$/.test(normalized))
    return "all";
  const aliases: Record<string, Status> = {
    successful: "success",
    "in progress": "in_progress",
    "timed out": "failure",
  };
  return (
    (Object.entries(statusLabels).find(
      ([, name]) => name.toLowerCase() === normalized,
    )?.[0] as Status | undefined) ??
    aliases[normalized] ??
    null
  );
};

type SharedJobControlsValue = {
  status: Status | "all";
  hasNativeFilter: boolean;
  hideSkipped: boolean;
  failureFocus: boolean;
  groupBy: GroupBy;
  matchesJob: (name: string, status: string) => boolean;
  matchesTitle: (title: string, status: Status) => boolean;
  isFailure: (status: string) => boolean;
  setStatus: (value: Status | "all") => void;
  setHideSkipped: (value: boolean) => void;
  setFailureFocus: (value: boolean) => void;
  setGroupBy: (value: GroupBy) => void;
};

const SharedJobControlsContext = createContext<SharedJobControlsValue | null>(
  null,
);

const findNativeStatusFilter = (doc: Document) =>
  Array.from(
    doc.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Workflow run"] button',
    ),
  ).find(
    (button) =>
      (
        button.getAttribute("aria-label") ??
        button
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => doc.getElementById(id)?.textContent ?? "")
          .join(" ")
      )?.trim() === "Filter by job status",
  ) ?? null;

const nativeStatusPopups = (button: HTMLButtonElement, doc: Document) => {
  const popupIds = [
    button.getAttribute("aria-controls"),
    button.getAttribute("aria-owns"),
  ]
    .filter(Boolean)
    .flatMap((ids) => ids?.split(/\s+/) ?? []);
  const controlledPopups = popupIds
    .map((id) => doc.getElementById(id))
    .filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
  const labels = new Set(
    [
      button.id,
      ...(button.getAttribute("aria-labelledby")?.split(/\s+/) ?? []),
    ].filter(Boolean),
  );
  return controlledPopups.length > 0
    ? controlledPopups
    : Array.from(
        doc.querySelectorAll<HTMLElement>(
          '[role="menu"], [role="listbox"], [role="dialog"]',
        ),
      ).filter((popup) =>
        popup
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .some((id) => labels.has(id)),
      );
};

const readNativeStatusFilter = (
  button: HTMLButtonElement | null,
  doc: Document,
): { open: boolean; status: NativeFilterStatus } => {
  if (!button) return { open: false, status: null };
  const popups = nativeStatusPopups(button, doc);
  const open =
    button.getAttribute("aria-expanded") === "true" ||
    (button.getAttribute("aria-expanded") !== "false" &&
      popups.some(
        (popup) =>
          !popup.hidden && popup.getAttribute("aria-hidden") !== "true",
      ));
  const candidates = popups.flatMap((popup) =>
    Array.from(
      popup.querySelectorAll<HTMLElement>(
        'input[type="radio"], input[type="checkbox"], [role="radio"], [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"]',
      ),
    )
      .filter(
        (option) =>
          (option instanceof HTMLInputElement && option.checked) ||
          option.getAttribute("aria-checked") === "true" ||
          option.getAttribute("aria-selected") === "true",
      )
      .map((option) => {
        const label = (
          option.closest("label")?.textContent ??
          option.getAttribute("aria-label") ??
          option.querySelector('[data-component="ActionList.Item.Label"]')
            ?.textContent ??
          option.textContent ??
          ""
        )
          .replace(/\s+\(\d+\)\s*$/, "")
          .trim()
          .toLowerCase();
        return {
          label,
          popup,
          custom: option.hasAttribute("data-ae-exclude-skipped"),
        };
      }),
  );
  const nativeCandidates = candidates.filter(({ custom }) => !custom);
  const checked = nativeCandidates.length ? nativeCandidates : candidates;
  if (checked.length !== 1) return { open, status: null };
  const label = checked[0]?.label;
  if (!label) return { open, status: null };
  return {
    open,
    status: nativeStatusForLabel(label),
  };
};

const useNativeStatusFilter = (
  hideSkipped: boolean,
  setHideSkipped: (value: boolean) => void,
) => {
  const [button, setButton] = useState(() => findNativeStatusFilter(document));
  const [selected, setSelected] = useState<NativeFilterStatus>(null);
  useLayoutEffect(() => {
    const added = new Set<HTMLElement>();
    let selectingDefault = false;
    const optionLabel = (option: Element) =>
      (
        option.querySelector('[data-component="ActionList.Item.Label"]')
          ?.textContent ??
        option.getAttribute("aria-label") ??
        option.textContent ??
        ""
      ).trim();
    const update = () => {
      const currentButton = findNativeStatusFilter(document);
      setButton((previous) =>
        previous === currentButton ? previous : currentButton,
      );
      if (currentButton) {
        const next = readNativeStatusFilter(currentButton, document);
        if (next.open) setSelected(next.status);
        const controlledAll = nativeStatusPopups(currentButton, document)
          .flatMap((popup) =>
            Array.from(
              popup.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
            ),
          )
          .find((option) => /^All$/.test(optionLabel(option)));
        if (controlledAll) {
          let custom = controlledAll.parentElement?.querySelector<HTMLElement>(
            "[data-ae-exclude-skipped]",
          );
          if (!custom) {
            custom = controlledAll.cloneNode(true) as HTMLElement;
            custom
              .querySelectorAll("[id]")
              .forEach((element) => element.removeAttribute("id"));
            custom.removeAttribute("id");
            custom.removeAttribute("aria-labelledby");
            custom.removeAttribute("aria-keyshortcuts");
            custom.setAttribute("aria-label", "All except skipped");
            custom.setAttribute("data-ae-exclude-skipped", "");
            const label = custom.querySelector(
              '[data-component="ActionList.Item.Label"]',
            );
            if (label) label.textContent = "All except skipped";
            else custom.textContent = "All except skipped";
            custom
              .querySelectorAll('[data-component="ActionList.TrailingVisual"]')
              .forEach((element) => element.remove());
            custom.tabIndex = 0;
            custom.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              selectingDefault = true;
              controlledAll.click();
              selectingDefault = false;
              setSelected("all");
              setHideSkipped(true);
            });
            custom.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                custom?.click();
              }
            });
            controlledAll.after(custom);
            added.add(custom);
          }
          const checked =
            hideSkipped && (next.status === "all" || next.status === null);
          const state = String(checked);
          if (custom.getAttribute("aria-checked") !== state)
            custom.setAttribute("aria-checked", state);
          if (checked && controlledAll.getAttribute("aria-checked") === "true")
            controlledAll.setAttribute("aria-checked", "false");
        }
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-controls",
        "aria-owns",
        "aria-checked",
        "aria-selected",
        "aria-label",
        "checked",
        "aria-expanded",
        "aria-labelledby",
      ],
    });
    const onChange = () => update();
    const onClick = (event: MouseEvent) => {
      if (selectingDefault || !(event.target instanceof Element)) return;
      const option = event.target.closest('[role="menuitemradio"]');
      if (
        option &&
        !option.hasAttribute("data-ae-exclude-skipped") &&
        option.parentElement?.querySelector("[data-ae-exclude-skipped]")
      ) {
        const status = nativeStatusForLabel(optionLabel(option));
        if (status === "all") setHideSkipped(false);
        if (status !== null) setSelected(status);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.target instanceof Element) ||
        !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      )
        return;
      const menu = event.target.closest('[role="menu"]');
      if (!menu?.querySelector("[data-ae-exclude-skipped]")) return;
      const options = Array.from(
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitemradio"]:not([aria-disabled="true"])',
        ),
      );
      const index = options.findIndex(
        (option) =>
          option === event.target || option.contains(event.target as Node),
      );
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length;
      options.forEach((option, position) => {
        option.tabIndex = position === next ? 0 : -1;
      });
      options[next]?.focus();
    };
    document.addEventListener("change", onChange, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      added.forEach((element) => {
        if (element.getAttribute("aria-checked") === "true")
          element.previousElementSibling?.setAttribute("aria-checked", "true");
        element.remove();
      });
    };
  }, [hideSkipped, setHideSkipped]);
  useLayoutEffect(() => {
    button?.setAttribute("data-ae-native-job-filter", "");
    return () => button?.removeAttribute("data-ae-native-job-filter");
  }, [button]);
  return { button, selected };
};

export const useOptionalSharedJobControls = () =>
  useContext(SharedJobControlsContext);

const normalizedStatus = (value: string): Status => {
  const status = value.toLowerCase().replaceAll(" ", "_");
  if (status === "passed") return "success";
  if (status === "running") return "in_progress";
  if (
    status === "failed" ||
    status === "timed_out" ||
    status === "startup_failure"
  )
    return "failure";
  if (status === "canceled") return "cancelled";
  if (status in statusLabels) return status as Status;
  return "unknown";
};

export const useSharedJobControls = () => {
  const controls = useOptionalSharedJobControls();
  if (!controls)
    throw new Error("Shared job controls must be used within their provider.");
  return controls;
};

export const SharedJobControlsPanel = ({ items }: { items: Item[] }) => {
  const id = useId();
  const controls = useSharedJobControls();
  const {
    status,
    hasNativeFilter,
    hideSkipped,
    failureFocus,
    groupBy,
    matchesTitle,
  } = controls;
  const counts = useMemo(
    () =>
      items.reduce(
        (totals, item) => {
          totals[item.status] = (totals[item.status] ?? 0) + 1;
          return totals;
        },
        {} as Partial<Record<Status, number>>,
      ),
    [items],
  );
  const matchingCount = items.filter(({ title, status: jobStatus }) =>
    matchesTitle(title, jobStatus),
  ).length;

  return (
    <section
      className="ae-job-controls"
      aria-label="Loaded job controls"
      data-actions-enhanced="job-controls"
    >
      <div className="ae-job-controls-toolbar">
        <p className="ae-job-controls-count">
          <strong>{matchingCount}</strong>
          {matchingCount !== items.length && ` of ${items.length}`} jobs
          <span className="color-fg-muted f6"> in the loaded list</span>
        </p>
        <div className="ae-job-controls-menus">
          {!hasNativeFilter && (
            <details className="ae-job-controls-menu">
              <summary className="btn btn-sm">
                Filter
                {status !== "all" && (
                  <span className="CounterLabel" aria-label="Active filters">
                    1
                  </span>
                )}
              </summary>
              <fieldset className="ae-job-controls-popover Box Box--overlay">
                <legend>Filter jobs by state</legend>
                <label>
                  <input
                    type="radio"
                    name={`${id}-status`}
                    value="all"
                    checked={status === "all"}
                    onChange={() => controls.setStatus("all")}
                  />
                  All states <span>{items.length}</span>
                </label>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`${id}-status`}
                      value={value}
                      checked={status === value}
                      onChange={() => controls.setStatus(value as Status)}
                    />
                    {label} <span>{counts[value as Status] ?? 0}</span>
                  </label>
                ))}
              </fieldset>
            </details>
          )}
          <details className="ae-job-controls-menu">
            <summary className="btn btn-sm">Display</summary>
            <div className="ae-job-controls-popover Box Box--overlay">
              <fieldset>
                <legend>Display options</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={hideSkipped}
                    onChange={(event) =>
                      controls.setHideSkipped(event.target.checked)
                    }
                  />
                  Hide skipped
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={failureFocus}
                    onChange={(event) =>
                      controls.setFailureFocus(event.target.checked)
                    }
                  />
                  Failures only
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={groupBy === "state"}
                    onChange={(event) =>
                      controls.setGroupBy(
                        event.target.checked ? "state" : "none",
                      )
                    }
                  />
                  Group by state
                </label>
              </fieldset>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
};

export const SharedJobControlsProvider = ({
  surface,
  children,
}: {
  surface: Surface;
  children: ReactNode;
}) => {
  const [status, setStatus] = useState<Status | "all">("all");
  const [hideSkipped, setHideSkipped] = useState(true);
  const [failureFocus, setFailureFocus] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const nativeFilter = useNativeStatusFilter(hideSkipped, setHideSkipped);
  const effectiveStatus =
    nativeFilter.button !== null ? (nativeFilter.selected ?? "all") : status;
  const isFailure = (value: string) => normalizedStatus(value) === "failure";
  const matchesTitle = (_title: string, rawStatus: string) => {
    const jobStatus = normalizedStatus(rawStatus);
    return (
      (effectiveStatus === "all" || jobStatus === effectiveStatus) &&
      (!hideSkipped ||
        jobStatus !== "skipped" ||
        effectiveStatus === "skipped") &&
      (!failureFocus || jobStatus === "failure")
    );
  };
  const value = useMemo<SharedJobControlsValue>(
    () => ({
      status: effectiveStatus,
      hasNativeFilter: nativeFilter.button !== null,
      hideSkipped,
      failureFocus,
      groupBy,
      matchesJob: matchesTitle,
      matchesTitle: (title, rawStatus) => matchesTitle(title, rawStatus),
      isFailure,
      setStatus,
      setHideSkipped,
      setFailureFocus,
      setGroupBy,
    }),
    [
      status,
      effectiveStatus,
      nativeFilter.button,
      hideSkipped,
      failureFocus,
      groupBy,
    ],
  );
  const visibleIds = new Set(
    surface.items
      .filter(({ title, status: jobStatus }) =>
        value.matchesTitle(title, jobStatus),
      )
      .map(({ id }) => id),
  );

  useLayoutEffect(() => {
    surface.targets.forEach(({ id: jobId, element }) => {
      if (visibleIds.has(jobId))
        element.removeAttribute("data-ae-filtered-job");
      else element.setAttribute("data-ae-filtered-job", "");
    });
    return () =>
      surface.targets.forEach(({ element }) =>
        element.removeAttribute("data-ae-filtered-job"),
      );
  }, [surface.targets, visibleIds]);

  return (
    <SharedJobControlsContext.Provider value={value}>
      {children}
    </SharedJobControlsContext.Provider>
  );
};

export const filterJobs = <T extends { name: string; status: string }>(
  jobs: T[],
  matchesJob: (name: string, status: string) => boolean,
) => jobs.filter(({ name, status }) => matchesJob(name, status));

export const groupJobsByState = <T extends { status: string }>(jobs: T[]) => {
  const groups = new Map<string, T[]>();
  jobs.forEach((job) => {
    const state = normalizedStatus(job.status);
    groups.set(state, [...(groups.get(state) ?? []), job]);
  });
  return [...groups.entries()].sort(([a], [b]) =>
    statusLabels[a as Status].localeCompare(statusLabels[b as Status]),
  );
};
