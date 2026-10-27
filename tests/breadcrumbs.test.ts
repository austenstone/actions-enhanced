import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Breadcrumbs } from "../entrypoints/actions.content/Breadcrumbs";
import { readBreadcrumbs, readNavigationBreadcrumbs } from "../lib/breadcrumbs";
import type { Surface } from "../lib/github";

const run = "/acme/widget/actions/runs/123";
const current = (suffix = "") => new URL(`https://github.com${run}${suffix}`);
const fixture = () => {
  document.body.innerHTML = `<main>
    <page-header><a href="/acme/widget/actions/workflows/ci.yml">Build &amp; test</a>
      <h1 class="PageHeader-title"><span class="markdown-title">Fix &lt;widget&gt;</span> <span>#42</span></h1>
    </page-header>
    <nav><a href="${run}">Summary</a>
      <a href="${run}/job/456"><svg><title>Passed</title></svg><span data-component="ActionList.Item.Label">test (Linux)</span></a>
      <a href="${run}/job/789">deploy</a>
    </nav>
    <a class="branch-name" href="/acme/widget/tree/refs/heads/feature%2Fwidgets">feature/widgets</a>
    <a href="/acme/widget/commit/abcdef0123456789">abcdef0</a>
  </main>`;
};

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("native breadcrumb extraction", () => {
  it("uses native labels and URLs in workflow, branch, commit, run, job order", () => {
    fixture();
    expect(readBreadcrumbs(document, current("/job/456"))).toEqual([
      {
        level: "workflow",
        label: "Build & test",
        href: "/acme/widget/actions/workflows/ci.yml",
      },
      {
        level: "branch",
        label: "feature/widgets",
        href: "/acme/widget/tree/refs/heads/feature%2Fwidgets",
      },
      {
        level: "commit",
        label: "abcdef0",
        href: "/acme/widget/commit/abcdef0123456789",
      },
      { level: "run", label: "Fix <widget> #42", href: run },
      { level: "job", label: "test (Linux)", href: `${run}/job/456` },
    ]);
  });

  it("omits unobserved metadata without guessing labels or run numbers", () => {
    document.body.innerHTML = `<main><nav><a href="${run}">Summary</a><a href="${run}/job/456">test</a></nav></main>`;
    expect(readBreadcrumbs(document, current())).toEqual([]);
    expect(readBreadcrumbs(document, current("/job/456"))).toEqual([
      { level: "job", label: "test", href: `${run}/job/456` },
    ]);
    document.body.innerHTML = "<main><h1>Unverified title</h1></main>";
    expect(readBreadcrumbs(document, current())).toEqual([]);
  });

  it("follows native job paths and selected jobs carried on summary views", () => {
    fixture();
    expect(readBreadcrumbs(document, current()).at(-1)?.level).toBe("run");
    for (const suffix of [
      "/job/456",
      "?ae_view=graph&ae_job=456",
      "?ae_view=annotations&ae_job=456",
    ]) {
      expect(readBreadcrumbs(document, current(suffix)).at(-1)?.label).toBe(
        "test (Linux)",
      );
    }
    expect(
      readBreadcrumbs(document, current("?ae_view=graph&ae_job=999")).at(-1)
        ?.level,
    ).toBe("run");
    expect(
      readBreadcrumbs(
        document,
        new URL("https://github.com/acme/widget/actions"),
      ),
    ).toEqual([]);
  });

  it("rejects foreign, cross-repository, executable and malformed links", () => {
    document.body.innerHTML = `<main><h1 class="PageHeader-title">Run #1</h1>
      <a href="https://evil.example/acme/widget/tree/main">foreign</a>
      <a href="/acme/other/tree/main">other repo</a>
      <a href="javascript:alert(1)">script</a>
      <a href="https://user:pass@github.com/acme/widget/tree/main">credentials</a>
      <a href="http://github.com/acme/widget/tree/main">insecure</a>
      <a href="https://[">broken</a>
      <a href="/acme/widget/commit/not-a-sha">not a commit</a>
      <a href="/acme/widget/tree/">not a branch</a>
      <a href="/acme/widget/actions/workflows/ci.yml/evil">not a workflow</a>
      <a href="/acme/widget/tree/main&#10;">control character</a>
    </main>`;
    expect(readBreadcrumbs(document, current())).toEqual([]);
  });

  it("uses a graph's native job label when summary navigation has no job links", () => {
    fixture();
    document.querySelectorAll('nav a[href*="/job/"]').forEach((link) => {
      link.remove();
    });
    document.querySelector("main")?.insertAdjacentHTML(
      "beforeend",
      `<a href="${run}/job/456"><svg aria-label="Passed"></svg>
        <span data-target="streaming-graph-job.name">test (Linux)</span><span>6s</span>
      </a>`,
    );
    expect(
      readBreadcrumbs(document, current("?ae_view=graph&ae_job=456")).at(-1),
    ).toEqual({
      level: "job",
      label: "test (Linux)",
      href: `${run}/job/456`,
    });
  });

  it("ignores extension-owned links, headings and nested label content", () => {
    fixture();
    const main = document.querySelector("main");
    main?.insertAdjacentHTML(
      "afterbegin",
      `<div data-actions-enhanced>
        <h1 class="PageHeader-title">Wrong title</h1>
        <a href="/acme/widget/actions/workflows/evil.yml">Wrong workflow</a>
        <a href="/acme/widget/tree/evil">Wrong branch</a>
        <a href="/acme/widget/commit/eeeeeee">Wrong commit</a>
        <nav><a href="${run}/job/456">Wrong job</a></nav>
      </div>`,
    );
    document
      .querySelector(".markdown-title")
      ?.insertAdjacentHTML(
        "beforeend",
        "<span data-actions-enhanced>Injected label</span>",
      );
    const breadcrumbs = readBreadcrumbs(document, current("/job/456"));
    expect(breadcrumbs.map(({ label }) => label)).toEqual([
      "Build & test",
      "feature/widgets",
      "abcdef0",
      "Fix <widget> #42",
      "test (Linux)",
    ]);
  });

  it("preserves native node identities and markup", () => {
    fixture();
    const before = document.body.innerHTML;
    const heading = document.querySelector("h1");
    readBreadcrumbs(document, current("/job/456"));
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector("h1")).toBe(heading);
  });
});

describe("Primer breadcrumbs", () => {
  const surface = (kind: Surface["kind"] = "jobs"): Surface => ({
    kind,
    anchor: document.querySelector("nav") ?? document.body,
    nativeList: null,
    repository: "acme/widget",
    items: [],
    targets: [],
  });
  const render = (kind?: Surface["kind"]) =>
    renderToStaticMarkup(
      createElement(Breadcrumbs, { surface: surface(kind) }),
    );

  it("renders a landmark and ordered list with one current-page link", () => {
    fixture();
    window.history.replaceState(null, "", `${run}/job/456?ae_view=table`);
    const host = document.createElement("div");
    host.innerHTML = render();
    expect(host.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Workflow run breadcrumbs",
    );
    expect(host.querySelectorAll("ol.breadcrumb > li")).toHaveLength(6);
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const selected = host.querySelector('[aria-current="page"]');
    expect(selected?.textContent).toBe("test (Linux)");
    expect(selected?.getAttribute("href")).toBe(
      `https://github.com${run}/job/456?ae_view=table`,
    );
    expect(host.innerHTML).toContain("&lt;widget&gt;");
    expect(host.querySelectorAll("a:not([href])")).toHaveLength(0);
    expect(host.querySelector("a")?.hasAttribute("onclick")).toBe(false);
  });

  describe("Actions-scoped breadcrumb navigation", () => {
    it("adds a repository run-list home and filters branches instead of opening source", () => {
      fixture();
      const crumbs = readNavigationBreadcrumbs(
        document,
        current("/job/456?ae_view=table"),
      );
      expect(crumbs[0]).toEqual({
        level: "actions",
        label: "Actions",
        href: "/acme/widget/actions",
      });
      expect(crumbs.find((crumb) => crumb.level === "workflow")?.href).toBe(
        "/acme/widget/actions/workflows/ci.yml",
      );
      const branch = new URL(
        crumbs.find((crumb) => crumb.level === "branch")?.href ?? "",
        current(),
      );
      expect(branch.pathname).toBe("/acme/widget/actions");
      expect(branch.searchParams.get("query")).toBe("branch:feature/widgets");
      expect(branch.searchParams.has("ae_view")).toBe(false);
      expect(branch.searchParams.has("ae_job")).toBe(false);
    });
  });

  it("does not render on workflow lists or unrecognized pages", () => {
    fixture();
    expect(render("runs")).toBe("");
    expect(render()).toBe("");
  });

  it("updates current-page semantics as summary and selected jobs change", () => {
    fixture();
    const host = document.createElement("div");
    for (const [suffix, expected] of [
      ["", "Fix <widget> #42"],
      ["?ae_view=graph&ae_job=456", "test (Linux)"],
      ["/job/789", "deploy"],
      ["?ae_view=annotations", "Fix <widget> #42"],
    ]) {
      window.history.replaceState(null, "", `${run}${suffix}`);
      host.innerHTML = render();
      expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
        expected,
      );
    }
  });
});
// @vitest-environment-options {"url": "https://github.com"}
