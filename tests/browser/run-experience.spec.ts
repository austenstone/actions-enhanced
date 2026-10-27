import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
} from "@playwright/test";

const test = base.extend<{ extension: BrowserContext }>({
  extension: async ({}, use) => {
    const profile = await mkdtemp(
      path.join(tmpdir(), "actions-enhanced-integration-"),
    );
    const extensionPath = path.resolve(".output/chrome-mv3");
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1440, height: 1000 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    try {
      await use(context);
    } finally {
      await context.close();
      await rm(profile, { recursive: true });
    }
  },
});

test("integrated Primer run navigation keeps native run content and URL context", async ({
  extension,
}) => {
  const page = await extension.newPage();
  await page.route("https://github.com/**", (route) => {
    const current = new URL(route.request().url());
    const jobPath = "/acme/widget/actions/runs/102/job/12";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CI #102</title></head><body>
      <main><a href="/acme/widget/actions/workflows/ci.yml">CI</a>
      <page-header>
        <div class="PageHeader-contextBar"><a href="/acme/widget/actions/workflows/ci.yml">CI</a></div>
        <div class="PageHeader-titleBar" style="display:flex">
          <div class="PageHeader-titleWrap">
            <span class="actions-workflow-runs-status"><svg class="octicon octicon-x-circle-fill"></svg></span>
            <h1 class="PageHeader-title"><span class="markdown-title">Fix Windows</span> #102</h1>
          </div>
          <div class="PageHeader-actions"><button id="native-options">Workflow run options</button></div>
        </div>
        <div class="PageHeader-navigation"><button id="native-mobile-nav">Summary</button></div>
      </page-header>
      <split-page-layout><div class="PageLayout-columns">
        <aside class="PageLayout-pane" style="position:sticky;top:0;max-height:90vh;overflow:auto">
          <nav aria-label="Workflow run"><ul>
            <li><a data-test-selector="summary-link" href="/acme/widget/actions/runs/102">Summary</a></li>
            <li><a data-test-selector="job-link" href="/acme/widget/actions/runs/102/job/11"><svg class="octicon octicon-check-circle-fill"></svg><span data-component="ActionList.Item.Label">build</span></a></li>
            <li><a data-test-selector="job-link" href="${jobPath}" ${current.pathname === jobPath ? 'aria-current="page"' : ""}><svg class="octicon octicon-x-circle-fill"></svg><span data-component="ActionList.Item.Label">test Windows</span></a></li>
          <li data-component="ActionList.Group"><h3>Run details</h3><ul>
            <li><a data-test-selector="usage-link" href="/acme/widget/actions/runs/102/usage"><svg class="octicon octicon-stopwatch"></svg><span>Usage</span></a></li>
            <li><a data-test-selector="workflow-file-link" href="/acme/widget/actions/runs/102/workflow"><svg class="octicon octicon-file-code"></svg><span>Workflow file</span></a></li>
            <li><a data-test-selector="lockfile-link" href="/acme/widget/actions/runs/102/lockfile"><svg class="octicon octicon-lock"></svg><span>Lockfile</span></a></li>
          </ul></li></ul></nav>
        </aside>
        <div class="PageLayout-content"><div data-ae-run-content>
          <div role="region" aria-label="Workflow run summary">
            <a href="/acme/widget/tree/main">main</a><a href="/acme/widget/commit/abcdef0123456789abcdef0123456789abcdef01">abcdef0</a>
            <button id="native-rerun" type="button">Re-run failed jobs</button>
          </div>
          <job-summaries><job-summary id="native-pr-summary"><h2>PR summary</h2><p>Native PR checks and results</p></job-summary></job-summaries>
          <div role="region" aria-label="Annotations"><h2>Annotations</h2><div>2 warnings</div><annotation-message>Native annotation</annotation-message></div>
          <div role="region" aria-label="Artifacts"><h2>Artifacts</h2><table><tbody><tr><td><a id="native-artifact" href="/artifact.zip">Download artifact</a></td></tr></tbody></table></div>
          ${/\/job\/\d+$/.test(current.pathname) ? '<section aria-label="Check run summary"><div class="js-check-steps"><check-step data-number="1" data-name="Run tests" data-conclusion="success" data-started-at="2026-10-26T10:00:00Z" data-completed-at="2026-10-26T10:00:05Z"></check-step>' : ""}
          <div id="native-log">Native content for ${current.pathname}</div>
          ${/\/job\/\d+$/.test(current.pathname) ? "</div></section>" : ""}
        </div></div>
      </div></split-page-layout></main></body></html>`,
    });
  });
  await page.goto(
    "https://github.com/acme/widget/actions/runs/102?check_suite_focus=true",
  );
  const experience = page.locator('[data-actions-enhanced="run-experience"]');
  await expect(experience).toBeVisible();
  await expect(
    page.locator('[data-test-selector="summary-link"]'),
  ).toBeHidden();
  await expect(
    experience.getByRole("link", { name: "List", exact: true }),
  ).toBeVisible();
  const header = page.locator('[data-actions-enhanced="run-header"]');
  await expect(header).toContainText("#102");
  await expect(header).toContainText("Failed");
  await expect(page.locator(".PageHeader-contextBar")).toBeHidden();
  await expect(page.locator("#native-options")).toBeVisible();
  for (const name of ["Usage", "Workflow file", "Lockfile"]) {
    await expect(
      page
        .locator(".PageHeader-titleBar")
        .getByRole("link", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page
      .locator('nav[aria-label="Workflow run"]')
      .getByRole("heading", { name: "Run details" }),
  ).toBeHidden();
  await expect(
    header.getByRole("link", { name: "Actions", exact: true }),
  ).toHaveAttribute("href", "/acme/widget/actions");
  await expect(
    header.getByRole("link", { name: "CI", exact: true }),
  ).toHaveAttribute("href", "/acme/widget/actions/workflows/ci.yml");
  await expect(
    header.getByRole("link", { name: "main", exact: true }),
  ).toHaveAttribute("href", "/acme/widget/actions?query=branch%3Amain");
  await expect(page.locator("#native-mobile-nav")).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: "Workflow run breadcrumbs",
      exact: true,
    }),
  ).toHaveCount(1);
  const details = page.getByRole("navigation", { name: "Run views" });
  await details.getByRole("link", { name: "Summary", exact: true }).click();
  await expect(page.locator("#native-rerun")).toBeVisible();
  await expect(page.locator("#native-pr-summary")).toBeVisible();
  await expect(page.locator("#native-artifact")).toBeHidden();
  await details.getByRole("link", { name: /^Annotations/ }).click();
  await expect(page.locator("annotation-message")).toBeVisible();
  await expect(page.locator("#native-pr-summary")).toBeHidden();
  await details.getByRole("link", { name: /^Artifacts/ }).click();
  await expect(page.locator("#native-artifact")).toBeVisible();
  await expect(page.locator("annotation-message")).toBeHidden();
  await details.getByRole("link", { name: "Summary", exact: true }).click();
  await expect(page.locator("#native-pr-summary")).toBeVisible();
  await details.getByRole("link", { name: "List", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Workflow run", exact: true }),
  ).toBeVisible();
  await experience.getByRole("link", { name: "Table", exact: true }).click();
  await expect(page).toHaveURL(/ae_view=table/);
  await expect(experience.getByRole("table")).toBeVisible();
  await header.getByRole("link", { name: "main", exact: true }).click();
  await expect(page).toHaveURL(
    "https://github.com/acme/widget/actions?query=branch%3Amain",
  );
  await page.goBack();
  await expect(experience.getByRole("table")).toBeVisible();
  await page.evaluate(() => {
    const header = document.querySelector("page-header");
    const button = document.querySelector("#native-options");
    button?.setAttribute("data-original-node", "yes");
    header
      ?.querySelector(".actions-workflow-runs-status svg")
      ?.setAttribute("class", "octicon octicon-check-circle-fill");
  });
  await expect(header.getByRole("status")).toContainText("Passed");
  await expect(page.locator("#native-options")).toHaveAttribute(
    "data-original-node",
    "yes",
  );
  await expect(page.locator("#native-log")).toBeHidden();
  await expect(page.locator(".ae-job-controls")).toHaveCount(0);
  await experience.locator('tbody a[href*="/job/12"]').click();
  await expect(page).toHaveURL(/\/job\/12.*ae_view=table/);
  await expect(experience.getByRole("table")).toBeVisible();
  await page.reload();
  await expect(experience.getByRole("table")).toBeVisible();
  await experience.getByRole("link", { name: "List", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("ae_view"))
    .toBeNull();
  await expect(page.locator("#native-log")).toBeVisible();
  await page.goBack();
  await expect(experience.getByRole("table")).toBeVisible();
  await expect(
    experience.getByRole("link", { name: "Waterfall", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const native = document.querySelector("[data-ae-run-content]");
    native?.replaceWith(native.cloneNode(true));
  });
  await expect(experience).toHaveCount(1);
  await expect(experience.getByRole("table")).toBeVisible();
  await page.goto(
    "https://github.com/acme/widget/actions/runs/102/attempts/2?ae_view=table",
  );
  await expect(experience.getByRole("table")).toBeVisible();
  await experience.locator('tbody a[href*="/job/12"]').click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("attempt"))
    .toBe("2");
  await expect(experience.getByRole("table")).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/acme/widget/issues");
    document.dispatchEvent(new Event("turbo:load"));
  });
  await expect(header).toHaveCount(0);
  await expect(page.locator("page-header")).not.toHaveAttribute(
    "data-ae-compact-header",
  );
  await expect(page.locator(".PageHeader-contextBar")).toBeVisible();
  await expect(page.locator("#native-options")).toBeVisible();
});

test("public GitHub run views inherit light/dark themes and retain native job logs", async ({
  extension,
}, testInfo) => {
  test.skip(!process.env.LIVE_GITHUB, "Opt in to public GitHub access.");
  const page = await extension.newPage();
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).hostname === "api.github.com" &&
      new URL(request.url()).pathname.startsWith("/repos/")
    )
      apiRequests.push(request.url());
  });
  await page.goto(
    "https://github.com/actions/checkout/actions/runs/39024106845",
  );
  const experience = page.locator('[data-actions-enhanced="run-experience"]');
  await expect(experience).toBeVisible();
  await expect(
    page.locator('[data-actions-enhanced="run-header"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workflow run", exact: true }),
  ).toBeVisible();
  await experience.getByRole("link", { name: "Table", exact: true }).click();
  await expect(experience.getByRole("table")).toBeVisible();
  await expect
    .poll(() => experience.locator("tbody tr").count())
    .toBeGreaterThan(1);
  await expect(
    experience.locator("tbody tr").filter({ hasText: "build" }).first(),
  ).toContainText("41s");
  await expect(
    page.locator('[data-actions-enhanced="run-header"] [role="status"]'),
  ).toContainText("Passed in 1m 45s");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-color-mode", value);
      document.documentElement.setAttribute("data-light-theme", "light");
      document.documentElement.setAttribute("data-dark-theme", "dark");
    }, theme);
    await page.screenshot({
      path: testInfo.outputPath(`run-table-${theme}.png`),
    });
  }
  await experience.locator("tbody tr a").first().click();
  await expect(page).toHaveURL(/\/job\/\d+.*ae_view=table/);
  await expect(experience.getByRole("table")).toBeVisible();
  await expect(
    page.locator("section[aria-label='Check run summary']").first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("run-table-narrow.png") });
  await expect(experience).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await experience.getByRole("link", { name: "Graph", exact: true }).click();
  await expect(page).toHaveURL(/ae_view=graph/);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("ae_job"))
    .not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.matches(
          'action-graph, [role="region"][aria-label="Workflow run graph"]',
        ),
      ),
    )
    .toBe(true);
  await expect(
    experience.getByRole("link", { name: /^Annotations/ }),
  ).toHaveCount(1);
  await page
    .getByRole("tablist", { name: "Job details" })
    .getByRole("tab", { name: /^Annotations/ })
    .click();
  await expect(page).toHaveURL(/ae_tab=annotations/);
});
