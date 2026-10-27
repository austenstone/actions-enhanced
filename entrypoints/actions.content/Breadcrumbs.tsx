import { readNavigationBreadcrumbs } from "../../lib/breadcrumbs";
import type { Surface } from "../../lib/github";
import { jobHref } from "../../lib/run-url";
import "./breadcrumbs.css";

export const Breadcrumbs = ({ surface }: { surface: Surface }) => {
  if (surface.kind !== "jobs") return null;
  const doc = surface.anchor.ownerDocument;
  const current = new URL(doc.location.href);
  const breadcrumbs = readNavigationBreadcrumbs(doc, current);
  if (!breadcrumbs.length) return null;
  return (
    <nav
      aria-label="Workflow run breadcrumbs"
      className="ae-breadcrumbs"
      data-actions-enhanced="breadcrumbs"
    >
      <ol className="breadcrumb">
        {breadcrumbs.map(({ level, label, href }, index) => {
          const isCurrent = index === breadcrumbs.length - 1;
          return (
            <li
              key={level}
              className={`breadcrumb-item${isCurrent ? " breadcrumb-item-selected" : ""}`}
            >
              <a
                className="Link"
                href={level === "job" ? jobHref(href, current) : href}
                aria-current={isCurrent ? "page" : undefined}
                title={label}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
