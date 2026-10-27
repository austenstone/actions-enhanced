import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type BrowserContext, test as base, expect } from "@playwright/test";

const extensionPath = path.resolve(".output/chrome-mv3");
const test = base.extend<{ extension: BrowserContext }>({
  extension: async ({ playwright }, use) => {
    const profile = await mkdtemp(
      path.join(tmpdir(), "actions-enhanced-test-"),
    );
    const context = await playwright.chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
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

const row = (
  id: number,
  title: string,
  icon: string,
) => `<li aria-label="Run ${id} of CI. ${title}">
  <svg class="octicon octicon-${icon}"></svg>
  <h4><a href="/acme/widget/actions/runs/${id}">${title}</a></h4>
  <a href="/octocat">octocat</a><a href="/acme/widget/tree/main">main</a>
  <button type="button" class="native-menu">Native run menu ${id}</button>
  </li>`;
const html = (content: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic Actions page</title></head><body><main>${content}</main></body></html>`;
const listHtml = () =>
  html(`<h1>All workflows</h1><ul id="native-runs">
  ${row(1, "Ship release", "check-circle-fill")}
  ${row(2, "Fix Windows integration", "x-circle-fill")}
  ${row(3, "Run deployment checks", "sync")}
  ${row(4, "External contribution", "alert")}
  </ul><a href="?page=2" id="pagination">Next page</a>`);

test("keeps run lists native without extra controls", async ({ extension }) => {
  const page = await extension.newPage();
  await page.route("https://github.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: listHtml() }),
  );
  await page.goto("https://github.com/acme/widget/actions");
  const controls = page.getByRole("region", { name: "Extra Actions controls" });
  const rows = page.locator("#native-runs > li:visible");
  await expect(controls).toHaveCount(0);
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("Ship release");
  await expect(page.locator("table")).toHaveCount(0);
  await expect(page.locator(".native-menu:visible")).toHaveCount(4);
  await expect(page.locator("#pagination")).toBeVisible();
  await page.evaluate(() => {
    const first = document.querySelector("#native-runs > li");
    if (first) first.setAttribute("data-identity-sentinel", "original");
  });
  await expect(rows.first()).toHaveAttribute(
    "data-identity-sentinel",
    "original",
  );
  await expect(rows.first()).toContainText("Ship release");
});

test("leaves run lists unchanged through updates and navigation", async ({
  extension,
}) => {
  const page = await extension.newPage();
  await page.route("https://github.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: listHtml() }),
  );
  await page.goto("https://github.com/acme/widget/actions");
  const controls = page.getByRole("region", { name: "Extra Actions controls" });
  await expect(controls).toHaveCount(0);
  await page.evaluate(
    (markup) =>
      document
        .querySelector("#native-runs")
        ?.insertAdjacentHTML("beforeend", markup),
    row(5, "Windows nightly", "clock"),
  );
  await expect(page.locator("#native-runs > li:visible")).toHaveCount(5);
  await page.evaluate(() => {
    history.pushState({}, "", "/acme/widget/issues");
    document.dispatchEvent(new Event("turbo:load"));
  });
  await expect(controls).toHaveCount(0);
  await expect(page.locator("#native-runs > li:visible")).toHaveCount(5);
  await page.evaluate(() => {
    history.pushState({}, "", "/acme/widget/actions");
    document.dispatchEvent(new Event("turbo:load"));
  });
  await expect(controls).toHaveCount(0);
  await page.evaluate(() => {
    document.querySelectorAll("#native-runs > li").forEach((li) => {
      const replacement = document.createElement("li");
      replacement.innerHTML = li.innerHTML;
      li.replaceWith(replacement);
    });
  });
  await expect(page.locator("#native-runs > li:visible")).toHaveCount(5);
  await page.evaluate(() => {
    document.querySelectorAll("#native-runs > li").forEach((li) => {
      const replacement = document.createElement("span");
      replacement.innerHTML = li.innerHTML;
      li.replaceWith(replacement);
    });
  });
  await expect(controls).toHaveCount(0);
  await expect(page.locator("#native-runs > span:visible")).toHaveCount(5);
});

test("enhances the native job sidebar without remaking or filtering logs and graph", async ({
  extension,
}) => {
  const page = await extension.newPage();
  const jobHtml =
    html(`<h1>Build widget #102</h1><nav aria-label="Workflow run"><ul>
    <li><a href="/acme/widget/actions/runs/102/job/11"><svg class="octicon octicon-check-circle-fill"></svg><span data-component="ActionList.Item.Label">build</span></a></li>
    <li><a href="/acme/widget/actions/runs/102/job/12"><svg class="octicon octicon-x-circle-fill"></svg><span data-component="ActionList.Item.Label">test (Windows)</span></a></li>
    </ul></nav><div id="native-graph">Existing native graph</div><div id="native-logs">Existing native logs</div><button id="native-rerun">Re-run failed jobs</button>`);
  await page.route("https://github.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: jobHtml }),
  );
  await page.goto("https://github.com/acme/widget/actions/runs/102");
  const controls = page.getByRole("region", { name: "Extra Actions controls" });
  const nav = page.getByRole("navigation", {
    name: "Workflow run",
    exact: true,
  });
  await expect(controls).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(2);
  await expect(page.locator("table")).toHaveCount(0);
  await controls
    .getByRole("combobox", { name: "Filter jobs by status" })
    .selectOption("attention");
  await expect(nav.locator("li:visible")).toHaveCount(1);
  await expect(page.locator("#native-graph")).toBeVisible();
  await expect(page.locator("#native-logs")).toBeVisible();
  await expect(page.locator("#native-rerun")).toBeVisible();
  await controls.getByRole("link", { name: "First failed job" }).click();
  await expect(page).toHaveURL(/\/job\/12$/);
  await expect(controls.getByText("Failure 1 of 1")).toBeVisible();
  await expect(controls.getByText("1 of 2 loaded jobs")).toBeVisible();
});

test("keeps native job selection, search and scroll while moving across failures", async ({
  extension,
}) => {
  const page = await extension.newPage();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.route("https://github.com/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const jobLinks = Array.from({ length: 40 }, (_, index) => {
      const id = index + 1;
      const failed = id === 20 || id === 35;
      const href = `/acme/widget/actions/runs/102/job/${id}`;
      return `<li style="min-height:36px"><a data-test-selector="job-link" href="${href}" ${pathname === href ? 'aria-current="page"' : ""}>
        <svg class="octicon octicon-${failed ? "x-circle-fill" : "check-circle-fill"}"></svg>
        <span data-component="ActionList.Item.Label">${failed ? "test windows" : "build linux"} ${id}</span>
      </a></li>`;
    }).join("");
    return route.fulfill({
      contentType: "text/html",
      body: html(`
      <style>
        .layout{display:flex;align-items:stretch}
        .PageLayout-pane{position:sticky;top:0;align-self:flex-start;height:620px;width:300px;overflow:auto;flex-shrink:0}
        .pane-body{min-height:1600px}
        .log-content{height:4000px;width:700px}
      </style><h1>Native run</h1><div class="layout"><aside class="PageLayout-pane"><div class="pane-body">
      <nav aria-label="Workflow run"><ul>${jobLinks}</ul></nav>
      </div></aside><div class="log-content" id="native-logs">Native log content. ${pathname}</div></div>`),
    });
  });
  await page.goto("https://github.com/acme/widget/actions/runs/102");
  const controls = page.getByRole("region", { name: "Extra Actions controls" });
  const pane = page.locator(".PageLayout-pane");
  const nav = page.getByRole("navigation", {
    name: "Workflow run",
    exact: true,
  });
  await expect(controls).toBeVisible();
  await pane.evaluate((element) => {
    element.scrollTop = 500;
  });
  const box = await pane.locator("[data-actions-enhanced]").boundingBox();
  const paneBox = await pane.boundingBox();
  expect(box?.y).toBeGreaterThanOrEqual(paneBox?.y ?? 0);
  expect(box?.y).toBeLessThan((paneBox?.y ?? 0) + 10);
  await controls.getByRole("searchbox").fill("windows");
  await controls.getByRole("combobox").selectOption("failure");
  await expect(nav.locator("li:visible")).toHaveCount(2);
  await controls.getByRole("link", { name: "First failed job" }).click();
  await expect(page).toHaveURL(/\/job\/20$/);
  await expect(controls.getByRole("searchbox")).toHaveValue("windows");
  await expect(controls.getByRole("combobox")).toHaveValue("failure");
  await expect(nav.locator('a[aria-current="page"]')).toHaveText(
    "test windows 20",
  );
  await expect(controls.getByText("Failure 1 of 2")).toBeVisible();
  await controls.getByRole("link", { name: "Next failed job" }).click();
  await expect(page).toHaveURL(/\/job\/35$/);
  await expect(controls.getByText("Failure 2 of 2")).toBeVisible();
  await controls
    .getByRole("link", { name: "Previous failed", exact: true })
    .click();
  await expect(page).toHaveURL(/\/job\/20$/);
  await controls.getByRole("searchbox").fill("linux");
  await expect(nav.locator('a[aria-current="page"]')).toBeVisible();
  await expect(controls.getByText(/current job kept visible/)).toBeVisible();
  await controls.getByRole("searchbox").press("Escape");
  await expect(controls.getByRole("combobox")).toHaveValue("all");
  await expect(nav.locator("li:visible")).toHaveCount(40);
  await controls.getByRole("searchbox").fill("windows");
  await controls.getByRole("searchbox").press("Enter");
  await expect(
    nav.getByRole("link", { name: "test windows 20" }),
  ).toBeFocused();
  await controls.getByRole("button", { name: "Show all" }).click();
  await pane.evaluate((element) => {
    element.scrollTop = 350;
  });
  await page.waitForFunction(
    () => document.querySelector(".PageLayout-pane")?.scrollTop === 350,
  );
  await page.reload();
  await expect(controls).toBeVisible();
  await expect
    .poll(() => pane.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.locator("#native-logs")).toBeVisible();
  await page.goto("https://github.com/acme/widget/actions/runs/103");
  await expect(controls).toHaveCount(0);
});

test("public GitHub native interface remains visible", async ({
  extension,
}, testInfo) => {
  test.skip(!process.env.LIVE_GITHUB, "Opt in to public GitHub access.");
  const page = await extension.newPage();
  await page.goto("https://github.com/actions/checkout/actions");
  const controls = page.getByRole("region", { name: "Extra Actions controls" });
  await expect(controls).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('a[href*="/actions/runs/"]').first()).toBeVisible();
  await expect(page.locator("actions-enhanced")).toHaveCount(0);
  await expect(controls.locator("table")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("github-native-runs.png"),
  });
  await page.goto(
    "https://github.com/actions/checkout/actions/runs/39024106845",
  );
  await expect(page.getByRole("navigation", { name: "Run views" })).toBeVisible(
    { timeout: 15_000 },
  );
  await expect(
    page.locator('[data-test-selector="job-link"]').first(),
  ).toBeVisible();
  await expect(page.locator(".ae-job-controls")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("github-native-jobs.png"),
  });
});
