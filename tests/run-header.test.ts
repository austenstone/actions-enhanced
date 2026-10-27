// @vitest-environment-options {"url":"https://github.com/"}
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  RunHeader,
  readRunHeader,
} from "../entrypoints/actions.content/RunHeader";

const current = new URL(
  "https://github.com/acme/widget/actions/runs/102/job/12",
);
afterEach(() => document.body.replaceChildren());

describe("compact native run header", () => {
  it("uses the selected job's raw-log commit when job pages omit ref links", () => {
    history.replaceState({}, "", current);
    const sha = "7b400065bbd8f11f556f2bbb62124bc0e887ba8c";
    document.body.innerHTML = `<main><page-header><h1 class="PageHeader-title">Run #42</h1></page-header>
      <a href="/acme/widget/commit/${sha}/checks/99/logs">Other logs</a>
      <a href="/acme/widget/commit/${sha}/checks/12/logs">View raw logs</a></main>`;
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(RunHeader));
    const link = host.querySelector('a[data-hovercard-type="commit"]');
    expect(link?.textContent).toBe("7b40006");
    expect(link?.getAttribute("data-hovercard-url")).toBe(
      `/acme/widget/commit/${sha}/hovercard`,
    );
    expect(
      readRunHeader(document, current)?.links.some(
        ({ level }) => level === "branch",
      ),
    ).toBe(false);
  });

  it("uses the run commit's native hovercard on ref and SHA links", () => {
    history.replaceState({}, "", current);
    document.body.innerHTML = `<main><page-header><h1 class="PageHeader-title">Run #42</h1></page-header>
      <a href="/acme/widget/tree/main">main</a>
      <a href="/acme/widget/commit/abcdef0123456789">abcdef0</a></main>`;
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(RunHeader));
    const links = host.querySelectorAll('a[data-hovercard-type="commit"]');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("data-hovercard-url")).toBe(
        "/acme/widget/commit/abcdef0123456789/hovercard",
      );
      expect(link.hasAttribute("title")).toBe(false);
    }
    expect(links[0]?.getAttribute("href")).toBe(
      "/acme/widget/actions?query=branch%3Amain",
    );
  });

  it("does not invent a commit hovercard when the native commit is absent", () => {
    history.replaceState({}, "", current);
    document.body.innerHTML = `<main><page-header><h1 class="PageHeader-title">Run #42</h1></page-header><a href="/acme/widget/tree/main">main</a></main>`;
    expect(renderToStaticMarkup(createElement(RunHeader))).not.toContain(
      "data-hovercard-url",
    );
  });
  it("combines selected job status and duration into one header value", () => {
    document.body.innerHTML = `<main><page-header><h1 class="PageHeader-title">Run #42</h1></page-header>
      <nav><a href="/acme/widget/actions/runs/102/job/12"><svg class="octicon octicon-check-circle-fill"></svg>test</a></nav>
      <section aria-label="Check run summary"><div class="js-checks-log-toolbar"><div class="CheckRun-log-title"><span class="js-updatable-content">completed in 7s</span></div></div></section></main>`;
    expect(readRunHeader(document, current)).toMatchObject({
      status: "success",
      duration: "7s",
    });
  });
  it("uses verified context, the actual run number and native status/duration", () => {
    document.body.innerHTML = `<main><page-header>
      <a href="/acme/widget/actions/workflows/ci.yml">CI</a>
      <div class="actions-workflow-runs-status"><svg class="octicon octicon-x-circle-fill"></svg></div>
      <h1 class="PageHeader-title"><span class="markdown-title">Fix tests (#999)</span> #42</h1>
      </page-header>
      <a href="/acme/widget/tree/main">main</a>
      <a href="/acme/widget/commit/abcdef0123456789">abcdef0</a>
      <nav><a href="/acme/widget/actions/runs/102/job/12">test Windows</a></nav>
      <a href="/acme/widget/actions/runs/102/usage">Usage</a>
      <a href="/acme/widget/actions/runs/102/usage">1h 42m</a></main>`;
    expect(readRunHeader(document, current)).toEqual({
      links: [
        { level: "actions", label: "Actions", href: "/acme/widget/actions" },
        {
          level: "workflow",
          label: "CI",
          href: "/acme/widget/actions/workflows/ci.yml",
        },
        {
          level: "branch",
          label: "main",
          href: "/acme/widget/actions?query=branch%3Amain",
        },
        {
          level: "commit",
          label: "abcdef0",
          href: "/acme/widget/commit/abcdef0123456789",
        },
        { level: "run", label: "#42", href: "/acme/widget/actions/runs/102" },
        {
          level: "job",
          label: "test Windows",
          href: "/acme/widget/actions/runs/102/job/12",
        },
      ],
      status: "failure",
      duration: "1h 42m",
      title: "Fix tests (#999) #42",
    });
  });
  it("does not invent missing status or durations, or read extension-owned usage links", () => {
    document.body.innerHTML = `<page-header><h1 class="PageHeader-title">Run #42</h1></page-header>
      <div data-actions-enhanced><a href="/acme/widget/actions/runs/102/usage">999s</a></div>`;
    expect(readRunHeader(document, current)).toMatchObject({
      status: "unknown",
      duration: "",
    });
    document.body.replaceChildren();
    expect(readRunHeader(document, current)).toBeNull();
  });
});
