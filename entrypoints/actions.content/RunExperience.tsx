import { Component, type ErrorInfo, type ReactNode } from "react";
import type { Surface } from "../../lib/github";
import { Breadcrumbs } from "./Breadcrumbs";
import { RunViews } from "./RunViews";
import { Waterfall } from "./Waterfall";

class RunExperienceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[Actions Enhanced] Extra run views failed. Native content is retained.",
      error,
      info,
    );
  }
  override render() {
    return this.state.failed ? (
      <p className="flash flash-warn" role="alert">
        Extra run views could not load. GitHub's native run content is still
        available below. Reload to retry.
      </p>
    ) : (
      this.props.children
    );
  }
}

export const RunExperience = ({ surface }: { surface: Surface }) => (
  <RunExperienceBoundary>
    {!document.querySelector("page-header[data-ae-compact-header]") && (
      <Breadcrumbs surface={surface} />
    )}
    <RunViews
      surface={surface}
      waterfallAvailable
      waterfall={<Waterfall surface={surface} />}
    />
  </RunExperienceBoundary>
);
