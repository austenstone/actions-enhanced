import path from "node:path";
import { expect, test } from "@playwright/test";

const runUrl = "https://github.com/acme/widget/actions/runs/102";
const api = "https://api.github.com/repos/acme/widget/actions";
const job = {
  id: 11,
  run_id: 102,
  run_attempt: 2,
  name: "Build with a long matrix job name (ubuntu-latest, node 22)",
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-26T10:00:00Z",
  completed_at: "2026-10-26T10:02:00Z",
};
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Waterfall fixture</title>
<style>
body { margin: 16px; font: 14px sans-serif; color: var(--fgColor-default); background: var(--bgColor-default) }
* { box-sizing: border-box }
.sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0 }
:root { --fgColor-default:#1f2328; --bgColor-default:#fff; --bgColor-muted:#f6f8fa; --borderColor-muted:#d1d9e0; --bgColor-accent-emphasis:#0969da }
html[data-color-mode="dark"] { --fgColor-default:#f0f6fc; --bgColor-default:#0d1117; --bgColor-muted:#151b23; --borderColor-muted:#3d444d; --bgColor-accent-emphasis:#1f6feb }
.Box { border:1px solid var(--borderColor-muted); border-radius:6px } .Box-header,.Box-body { padding:16px }
</style></head><body><main>
<h1>Native run</h1>
<nav aria-label="Workflow run"><ul><li><a href="/acme/widget/actions/runs/102/job/11"><span data-component="ActionList.Item.Label">Build</span></a></li></ul></nav>
<div data-ae-run-content><div id="native-graph">Native graph retained</div><div id="native-logs">Native logs retained</div></div>
</main></body></html>`;

test("waterfall loads automatically, handles errors, and keeps real native job links in both themes and narrow layouts", async ({
  playwright,
}, testInfo) => {
  const context = await playwright.chromium.launchPersistentContext(
    path.resolve(testInfo.outputPath("chrome-profile")),
    {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${path.resolve(".output/chrome-mv3")}`,
        `--load-extension=${path.resolve(".output/chrome-mv3")}`,
      ],
    },
  );
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const requests: string[] = [];
    let fail = true;
    await page.route("https://github.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: /\/job\/\d+/.test(route.request().url())
          ? '<section aria-label="Check run summary"><check-step data-number="1" data-name="Run tests" data-conclusion="success" data-started-at="2026-10-26T10:00:00Z" data-completed-at="2026-10-26T10:00:05Z"></check-step></section>'
          : fixture,
      }),
    );
    await page.route("https://api.github.com/**", (route) => {
      const url = route.request().url();
      requests.push(url);
      return route.fulfill({
        status: fail ? 403 : 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(
          fail
            ? { message: "API rate limit exceeded" }
            : url === `${api}/runs/102`
              ? { id: 102, run_attempt: 2 }
              : {
                  total_count: 3,
                  jobs: [
                    job,
                    {
                      ...job,
                      id: 13,
                      name: "Skipped job",
                      conclusion: "skipped",
                      started_at: null,
                      completed_at: null,
                    },
                    {
                      ...job,
                      id: 12,
                      name: "Test still running",
                      status: "in_progress",
                      conclusion: null,
                      completed_at: null,
                    },
                  ],
                },
        ),
      });
    });
    await page.goto(runUrl);
    await expect(
      page.getByRole("navigation", { name: "Run views" }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
    await page.getByRole("link", { name: "Waterfall", exact: true }).click();
    const waterfall = page.getByRole("region", {
      name: "Job execution waterfall",
    });
    await expect(waterfall.getByRole("alert")).toContainText("HTTP 403");
    expect(requests).toHaveLength(1);
    await expect(
      waterfall.locator("button:not(.ae-job-steps-toggle)"),
    ).toHaveCount(0);
    fail = false;
    await page.reload();
    await expect(waterfall.locator(".ae-waterfall-bar")).toHaveCount(2);
    await expect(waterfall.getByRole("heading")).toHaveCount(0);
    await expect(
      waterfall.locator("button:not(.ae-job-steps-toggle)"),
    ).toHaveCount(0);
    await expect(waterfall.getByRole("combobox")).toHaveCount(0);
    await expect(waterfall.getByRole("searchbox")).toHaveCount(0);
    await expect(waterfall.locator(".ae-timeline-row")).toHaveCount(2);
    await expect(
      waterfall.getByText("Skipped job", { exact: true }),
    ).toHaveCount(0);
    await expect(
      waterfall.getByRole("group", { name: /: 2m 0s execution/ }),
    ).toBeVisible();
    await expect(
      waterfall.getByRole("group", { name: /in progress \(local clock\)/ }),
    ).toBeVisible();
    await expect(
      waterfall.getByRole("link", { name: job.name, exact: true }),
    ).toHaveAttribute("href", `${runUrl}/job/11?ae_view=waterfall&attempt=2`);
    const barLink = waterfall.getByRole("link", {
      name: `Open ${job.name} logs`,
    });
    await expect(barLink).toHaveAttribute(
      "href",
      `${runUrl}/job/11?ae_view=waterfall&attempt=2`,
    );
    await barLink.focus();
    await expect(barLink).toBeFocused();
    expect(requests).toEqual([
      `${api}/runs/102`,
      `${api}/runs/102`,
      `${api}/runs/102/attempts/2/jobs?per_page=100&page=1`,
    ]);
    await expect(page.locator("#native-graph")).toBeVisible();
    await expect(page.locator("#native-logs")).toBeVisible();
    // The static fixture has no GitHub Turbo runtime; emulate its same-document
    // navigation so this checks the in-memory cache rather than a full reload.
    await page.evaluate(() => {
      document.addEventListener("click", (event) => {
        const link =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>(".ae-run-views nav a")
            : null;
        if (!link) return;
        event.preventDefault();
        history.pushState({}, "", link.href);
        document.dispatchEvent(new Event("turbo:load"));
      });
    });
    await page.getByRole("link", { name: "Table", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Loaded steps table" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Waterfall", exact: true }).click();
    await expect(waterfall.locator(".ae-timeline-row")).toHaveCount(2);
    expect(requests).toHaveLength(3);
    for (const theme of ["light", "dark"]) {
      await page
        .locator("html")
        .evaluate(
          (element, value) => element.setAttribute("data-color-mode", value),
          theme,
        );
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await waterfall.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
        for (const row of await waterfall.locator(".ae-timeline-row").all()) {
          const box = await row.locator(".ae-timeline-job").boundingBox();
          expect(box?.height).toBeLessThanOrEqual(32);
          const bar = await row.locator(".ae-waterfall-bar").boundingBox();
          const duration = await row
            .locator(".ae-timeline-elapsed")
            .boundingBox();
          expect(bar).not.toBeNull();
          expect(duration).not.toBeNull();
          expect(duration!.x).toBeGreaterThanOrEqual(bar!.x + bar!.width);
          expect(duration!.x - bar!.x - bar!.width).toBeLessThanOrEqual(10);
        }
        await page.screenshot({
          path: testInfo.outputPath(`waterfall-${theme}-${width}.png`),
        });
      }
    }
  } finally {
    await context.close();
  }
});

test("public GitHub page loads real REST timing without extension host permissions", async ({
  playwright,
}, testInfo) => {
  test.skip(!process.env.LIVE_GITHUB, "Opt in to public GitHub access.");
  const context = await playwright.chromium.launchPersistentContext(
    path.resolve(testInfo.outputPath("chrome-profile")),
    {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${path.resolve(".output/chrome-mv3")}`,
        `--load-extension=${path.resolve(".output/chrome-mv3")}`,
      ],
    },
  );
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith("https://api.github.com/repos/"))
        requests.push(request.url());
    });
    await page.goto(
      "https://github.com/actions/checkout/actions/runs/39024106845?ae_view=waterfall",
    );
    const waterfall = page.getByRole("region", {
      name: "Job execution waterfall",
    });
    await expect(waterfall.locator(".ae-waterfall-bar").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      waterfall.locator("button:not(.ae-job-steps-toggle)"),
    ).toHaveCount(0);
    await expect(waterfall.getByRole("heading")).toHaveCount(0);
    await expect(waterfall.locator(".ae-waterfall-bar")).toHaveCount(8);
    expect(
      requests.every((url) =>
        url.startsWith(
          "https://api.github.com/repos/actions/checkout/actions/",
        ),
      ),
    ).toBe(true);
    for (const theme of ["light", "dark"]) {
      await page.locator("html").evaluate((element, value) => {
        element.setAttribute("data-color-mode", value);
        element.setAttribute(`data-${value}-theme`, value);
      }, theme);
      await expect(waterfall).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`public-waterfall-${theme}.png`),
      });
    }
  } finally {
    await context.close();
  }
});
