export const annotationKinds = [
  {
    kind: "error",
    label: "errors",
    icon: "x-circle",
    color: "color-fg-danger",
    path: "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.22 5.22a.75.75 0 0 1 1.06 0L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 1 1-1.06 1.06L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 0-1.06Z",
  },
  {
    kind: "warning",
    label: "warnings",
    icon: "alert",
    color: "color-fg-attention",
    path: "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm1 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  },
  {
    kind: "notice",
    label: "notices",
    icon: "info",
    color: "color-fg-accent",
    path: "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  },
] as const;

export const readAnnotationCounts = (root: HTMLElement | null) => {
  const counts = { error: 0, warning: 0, notice: 0 };
  if (!root) return counts;
  const heading = Array.from(root.querySelectorAll("h2, h3, h4")).find(
    (element) => element.textContent?.trim() === "Annotations",
  );
  const summary = heading?.nextElementSibling?.textContent ?? "";
  const matches = [
    ...summary.matchAll(/\b(\d[\d,]*)\s+(error|warning|notice)s?\b/gi),
  ];
  if (matches.length) {
    for (const match of matches) {
      const kind = annotationKinds.find(
        ({ kind }) => kind === match[2]?.toLowerCase(),
      )?.kind;
      if (kind) counts[kind] += Number(match[1]?.replaceAll(",", ""));
    }
    return counts;
  }
  for (const message of root.querySelectorAll("annotation-message")) {
    const kind = message.querySelector(
      ".octicon-x-circle, .octicon-x-circle-fill",
    )
      ? "error"
      : message.querySelector(".octicon-alert")
        ? "warning"
        : message.querySelector(".octicon-info")
          ? "notice"
          : null;
    if (kind) counts[kind]++;
  }
  return counts;
};
