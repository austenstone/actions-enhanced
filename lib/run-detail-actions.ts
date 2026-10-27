const linkSelectors = [
  'a[data-test-selector="usage-link"]',
  'a[data-test-selector="workflow-file-link"]',
  'a[data-test-selector="lockfile-link"]',
] as const;

const actionClass = "ae-run-detail-action";
const groupClass = "ae-run-detail-actions";
const emptyGroupAttribute = "data-ae-run-detail-empty";
const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

type MovedLink = {
  anchor: HTMLAnchorElement;
  marker: Comment;
  group: HTMLElement;
  attributes: Map<string, string | null>;
};

export type RunDetailActions = {
  refresh: () => void;
  remove: () => void;
};

const findGroup = (anchor: HTMLAnchorElement): HTMLElement | undefined => {
  let parent = anchor.parentElement;
  while (parent && !parent.matches("body, main")) {
    if (
      [...parent.querySelectorAll(headingSelector)].some(
        (heading) => heading.textContent?.trim() === "Run details",
      )
    )
      return parent;
    parent = parent.parentElement;
  }
  return undefined;
};

const isEmptyGroup = (group: HTMLElement, moved: MovedLink[]) => {
  const copy = group.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return false;
  copy.querySelectorAll(headingSelector).forEach((heading) => {
    if (heading.textContent?.trim() === "Run details") heading.remove();
  });
  copy
    .querySelectorAll<HTMLAnchorElement>(linkSelectors.join(","))
    .forEach((anchor) => {
      if (
        moved.some(
          (record) =>
            linkSelectors.some(
              (selector) =>
                record.anchor.matches(selector) && anchor.matches(selector),
            ) && record.anchor.href === anchor.href,
        )
      )
        anchor.remove();
    });
  return (
    !copy.textContent?.trim() &&
    !copy.querySelector(
      "a, button, input, select, textarea, img, svg, [tabindex]",
    )
  );
};

/**
 * Call refresh after native DOM updates; remove before navigation or disabling.
 * The native anchors themselves move, keeping their listeners and destinations.
 */
export const installRunDetailActions = (
  root: Document | HTMLElement = document,
): RunDetailActions => {
  const ownerDocument = "createElement" in root ? root : root.ownerDocument;
  const moved: MovedLink[] = [];
  const hiddenGroups = new Map<HTMLElement, Map<string, string | null>>();
  let container: HTMLDivElement | undefined;

  const restoreLink = ({ anchor, marker, attributes }: MovedLink) => {
    if (marker.parentNode) marker.replaceWith(anchor);
    else anchor.remove();
    attributes.forEach((value, name) => {
      if (value === null) anchor.removeAttribute(name);
      else anchor.setAttribute(name, value);
    });
  };

  const restoreGroup = (
    group: HTMLElement,
    attributes: Map<string, string | null>,
  ) => {
    attributes.forEach((value, name) => {
      if (value === null) group.removeAttribute(name);
      else group.setAttribute(name, value);
    });
  };

  const restoreGroups = () => {
    hiddenGroups.forEach((attributes, group) =>
      restoreGroup(group, attributes),
    );
    hiddenGroups.clear();
  };

  const remove = () => {
    moved.splice(0).forEach(restoreLink);
    restoreGroups();
    container?.remove();
    container = undefined;
  };

  const refresh = () => {
    const header = root.querySelector<HTMLElement>(".PageHeader-titleBar");
    if (!header) {
      remove();
      return;
    }

    moved
      .filter(
        ({ marker, group, anchor }) =>
          !root.contains(marker) ||
          !root.contains(group) ||
          !container?.contains(anchor),
      )
      .forEach((record) => {
        restoreLink(record);
        moved.splice(moved.indexOf(record), 1);
      });

    const candidates = linkSelectors.flatMap((selector) => {
      const current = moved.find(({ anchor }) => anchor.matches(selector));
      const available = [...root.querySelectorAll<HTMLAnchorElement>(selector)]
        .filter((anchor) => !container?.contains(anchor))
        .map((anchor) => ({ anchor, group: findGroup(anchor) }))
        .filter(
          (item): item is { anchor: HTMLAnchorElement; group: HTMLElement } =>
            !!item.group,
        );
      if (current) return [];
      return available.slice(0, 1);
    });

    if (moved.length || candidates.length) {
      if (!container) {
        container = ownerDocument.createElement("div");
        container.className = groupClass;
        container.setAttribute("role", "group");
        container.setAttribute("aria-label", "Run details");
      }
      if (container.parentElement !== header) header.append(container);
    }

    candidates.forEach(({ anchor, group }) => {
      const attributes = new Map(
        ["class", "aria-label", "title"].map((name) => [
          name,
          anchor.getAttribute(name),
        ]),
      );
      const marker = ownerDocument.createComment("ae-run-detail-action");
      const label =
        anchor.getAttribute("aria-label") ||
        anchor.textContent?.trim() ||
        anchor.getAttribute("title");
      anchor.before(marker);
      anchor.classList.add(actionClass);
      if (label) {
        if (!anchor.getAttribute("aria-label"))
          anchor.setAttribute("aria-label", label);
        if (!anchor.getAttribute("title")) anchor.setAttribute("title", label);
      }
      container?.append(anchor);
      moved.push({ anchor, marker, group, attributes });
    });

    const groups = new Set([
      ...hiddenGroups.keys(),
      ...moved.map(({ group }) => group),
      ...[...root.querySelectorAll<HTMLAnchorElement>(linkSelectors.join(","))]
        .filter((anchor) => !container?.contains(anchor))
        .flatMap((anchor) => {
          const group = findGroup(anchor);
          return group ? [group] : [];
        }),
    ]);
    groups.forEach((group) => {
      if (moved.length > 0 && isEmptyGroup(group, moved)) {
        if (!hiddenGroups.has(group))
          hiddenGroups.set(
            group,
            new Map(
              ["hidden", emptyGroupAttribute].map((name) => [
                name,
                group.getAttribute(name),
              ]),
            ),
          );
        if (!group.hasAttribute("hidden")) group.setAttribute("hidden", "");
        if (!group.hasAttribute(emptyGroupAttribute))
          group.setAttribute(emptyGroupAttribute, "");
      } else if (hiddenGroups.has(group)) {
        const attributes = hiddenGroups.get(group);
        if (attributes) restoreGroup(group, attributes);
        hiddenGroups.delete(group);
      }
    });
    if (!moved.length) {
      container?.remove();
      container = undefined;
    }
  };

  refresh();
  return { refresh, remove };
};
