import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

test("native list steps open native logs without replacing rows and keep durations on the right", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "ae-steps-"));
  const extension = path.resolve(".output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const run = "/acme/widget/actions/runs/102";
  try {
    const page = await context.newPage();
    await page.route("https://github.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><style>
      body {margin:0;font:14px sans-serif}
      * {box-sizing:border-box}
      .PageLayout-pane nav a[data-test-selector] {display:flex;align-items:center;min-height:32px}
      </style></head><body><main>
      <page-header><div class="PageHeader-titleBar"><div class="PageHeader-titleWrap">
      <h1 class="PageHeader-title">CI #102</h1></div></div></page-header>
      <split-page-layout><div class="PageLayout-columns">
      <aside class="PageLayout-pane"><nav aria-label="Workflow run"><ul>
      <li><a href="${run}/job/11" data-test-selector="job-link"><svg class="octicon-check-circle-fill"></svg><span data-component="ActionList.Item.Label">Build</span></a></li>
      <li><a href="${run}/job/12" data-test-selector="job-link"><svg class="octicon-check-circle-fill"></svg><span data-component="ActionList.Item.Label">Test</span></a></li>
      </ul></nav></aside>
      <div class="PageLayout-content"><section aria-label="Check run summary">
      <div class="js-checks-log-toolbar"><div class="CheckRun-log-title"><span class="js-updatable-content">passed in 18s</span></div></div>
      <div class="js-check-steps"><details class="js-checks-log-details" data-step-number="1" data-conclusion="success" id="check-step-1">
      <summary><span class="CheckStep-titleName">Set up job</span><div class="text-small float-right">2s</div></summary><pre>Native log output</pre></details></div>
      </section></div></div></split-page-layout></main></body></html>`,
      }),
    );
    await page.goto(`https://github.com${run}/job/11`);
    const nav = page.getByRole("navigation", {
      name: "Workflow run",
      exact: true,
    });
    const disclosure = nav.locator(
      'li:has(> a[data-test-selector][href$="/11"]) .ae-native-job-steps',
    );
    await expect(disclosure.locator("summary")).toBeVisible();
    await expect(disclosure.locator(".ae-native-step-link")).toHaveCount(0);
    await nav.locator('a[data-test-selector="job-link"][href$="/11"]').click();
    await expect(
      disclosure.getByRole("link", { name: /Set up job/ }),
    ).toBeVisible();
    const nativeStep = page.locator("#check-step-1");
    await nativeStep.evaluate((element) =>
      element.setAttribute("data-retained", "true"),
    );
    await disclosure.getByRole("link", { name: /Set up job/ }).click();
    await expect(page).toHaveURL(/ae_step=1/);
    await expect(nativeStep).toHaveAttribute("open", "");
    await expect(nativeStep).toHaveAttribute("data-retained", "true");
    await expect(page.locator(".ae-native-log-toolbar")).toHaveCount(0);
    const other = nav.locator(
      'li:has(> a[data-test-selector][href$="/12"]) .ae-native-job-steps',
    );
    await nav.locator('a[data-test-selector="job-link"][href$="/12"]').click();
    await expect(other.getByRole("link", { name: /Set up job/ })).toBeVisible();
    await expect(
      other.getByRole("link", { name: /Set up job/ }),
    ).toHaveAttribute("href", /\/job\/12\?.*ae_step=1/);
    await expect(page).toHaveURL(/\/job\/11/);
    const row = nav.locator('a[data-test-selector="job-link"][href$="/11"]');
    const duration = row.locator(".ae-job-row-duration");
    await expect(duration).toHaveText("18s");
    const bounds = await row.boundingBox();
    const time = await duration.boundingBox();
    expect(time?.x ?? 0).toBeGreaterThan(
      (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
    );
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});
