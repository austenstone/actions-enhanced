import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

test("left panel contains long waterfall scrolling at desktop and mobile sizes", async ({
  page,
}) => {
  const styles = await Promise.all(
    ["style.css", "waterfall.css", "run-details.css"].map((file) =>
      readFile(path.resolve("entrypoints/actions.content", file), "utf8"),
    ),
  );
  await page.setContent(`
    <style>
      * { box-sizing: border-box }
      body { margin: 0 }
      split-page-layout { display: block }
      .PageLayout-columns { display: grid }
      .PageLayout-columns { padding-inline: 0 !important }
      .PageLayout-pane { padding: 0 0 16px 16px !important }
      .Box { border: 1px solid; border-radius: 6px }
      ${styles.join("\n")}
    </style>
    <split-page-layout data-ae-workspace data-ae-run-view="waterfall" style="--ae-workspace-top: 0px">
      <div class="PageLayout-columns">
        <aside class="PageLayout-region PageLayout-pane">
          <div id="ae-run-experience" data-actions-enhanced="run-experience"><div>
            <div class="ae-run-views">
              <nav class="UnderlineNav" aria-label="Run views">Summary List Table Waterfall</nav>
              <div class="ae-run-view-content">
                <section class="ae-waterfall" aria-label="Job execution waterfall">
                  <div class="ae-timeline"><div class="ae-timeline-scroll">
                    <div class="ae-timeline-grid" style="min-width:480px">
                      <div class="ae-timeline-ruler">Elapsed time</div>
                      <ul class="ae-waterfall-list">
                        ${Array.from({ length: 100 }, (_, index) => `<li class="ae-timeline-row"><div class="ae-timeline-job">Job ${index}</div><div class="ae-timeline-lane">Execution</div></li>`).join("")}
                      </ul>
                    </div>
                  </div></div>
                </section>
              </div>
            </div>
          </div></div>
        </aside>
        <div class="PageLayout-region PageLayout-content">Native logs</div>
      </div>
    </split-page-layout>
  `);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1440, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const pane = page.locator(".PageLayout-pane");
    const scroll = page.locator(".ae-run-view-content");
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    const paneBox = await pane.boundingBox();
    const scrollBox = await scroll.boundingBox();
    const tabsTop = await page
      .getByRole("navigation", { name: "Run views" })
      .evaluate((element) => element.getBoundingClientRect().top);
    if (!paneBox || !scrollBox) throw new Error("Missing left panel");
    expect(scrollBox.y + scrollBox.height).toBeLessThanOrEqual(
      paneBox.y + paneBox.height,
    );
    expect(scrollBox.x + scrollBox.width).toBeLessThanOrEqual(
      paneBox.x + paneBox.width,
    );
    expect(paneBox.y + paneBox.height).toBeLessThanOrEqual(viewport.height);
    const documentHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.scrollLeft = element.scrollWidth;
    });
    expect(
      await scroll.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    expect(
      await page
        .getByRole("navigation", { name: "Run views" })
        .evaluate((element) => element.getBoundingClientRect().top),
    ).toBe(tabsTop);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(documentHeight);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    if (viewport.width < 480)
      expect(
        await scroll.evaluate((element) => element.scrollLeft),
      ).toBeGreaterThan(0);
    const waterfall = page.getByRole("region", {
      name: "Job execution waterfall",
    });
    expect(
      await waterfall.evaluate(
        (element) => getComputedStyle(element).borderTopWidth,
      ),
    ).toBe("0px");
    await page.locator(".ae-waterfall-list").evaluate((element) => {
      element.style.display = "none";
    });
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    const shortBox = await waterfall.boundingBox();
    const contentBox = await scroll.boundingBox();
    if (!shortBox || !contentBox) throw new Error("Missing waterfall");
    expect(shortBox.y).toBe(contentBox.y);
    expect(shortBox.height).toBeGreaterThanOrEqual(contentBox.height - 1);
    await page.locator(".ae-waterfall-list").evaluate((element) => {
      element.style.display = "";
    });
    const layout = page.locator("split-page-layout");
    await layout.evaluate((element) =>
      element.setAttribute("data-ae-log-layout", "closed"),
    );
    const closedPane = await pane.boundingBox();
    if (!closedPane) throw new Error("Missing closed-log layout");
    expect(closedPane.x).toBe(16);
    expect(closedPane.x + closedPane.width).toBe(viewport.width - 16);
    await layout.evaluate((element) =>
      element.setAttribute("data-ae-has-job", "false"),
    );
    const summaryPane = await pane.boundingBox();
    expect(summaryPane?.x).toBe(16);
    expect((summaryPane?.x ?? 0) + (summaryPane?.width ?? 0)).toBe(
      viewport.width - 16,
    );
    await layout.evaluate((element) =>
      element.removeAttribute("data-ae-has-job"),
    );
    expect(
      await pane.evaluate((element) => getComputedStyle(element).padding),
    ).toBe("0px");
    await layout.evaluate((element) =>
      element.removeAttribute("data-ae-log-layout"),
    );
  }
});

test("fullscreen logs fill the viewport with short native output", async ({
  page,
}) => {
  const styles = await readFile(
    path.resolve("entrypoints/actions.content/style.css"),
    "utf8",
  );
  await page.setContent(`<style>* { box-sizing: border-box } body { margin: 0 } ${styles}</style>
    <split-page-layout data-ae-workspace data-ae-log-layout="fullscreen" style="--ae-workspace-top: 200px">
      <div class="PageLayout-columns">
        <aside class="PageLayout-region PageLayout-pane">Jobs</aside>
        <div class="PageLayout-region PageLayout-content">
          <div class="ae-job-detail-tabs" style="height:36px;flex-shrink:0">Log</div>
          <section aria-label="Check run summary">
            <div data-ae-detail-panel="log"><div class="js-check-steps">Short native output</div></div>
          </section>
        </div>
      </div>
    </split-page-layout>`);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const pane = await page.locator(".PageLayout-content").boundingBox();
    const logs = await page.locator(".js-check-steps").boundingBox();
    expect(pane).toMatchObject({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
    expect((logs?.y ?? 0) + (logs?.height ?? 0)).toBe(viewport.height);
    expect(logs?.width).toBe(viewport.width);
  }
});

test("details starts below tabs without an empty log frame and uses the dark workspace background", async ({
  page,
}) => {
  const styles = await readFile(
    path.resolve("entrypoints/actions.content/style.css"),
    "utf8",
  );
  await page.setContent(`<style>* { box-sizing: border-box } body { margin: 0 } ${styles}</style>
    <split-page-layout data-ae-workspace style="--ae-workspace-top:0px">
      <div class="PageLayout-columns"><aside class="PageLayout-region PageLayout-pane">Jobs</aside>
        <div class="PageLayout-region PageLayout-content" data-ae-detail-tab="details">
          <div class="ae-job-detail-tabs" style="height:36px">Tabs</div>
          <section aria-label="Check run summary" style="min-height:500px;background:#161b22"><div class="js-check-steps">Logs</div></section>
          <div class="ae-job-inspector-details">Job details</div>
        </div>
      </div>
    </split-page-layout>`);
  await page
    .locator("html")
    .evaluate((e) => e.setAttribute("data-color-mode", "dark"));
  await expect(
    page.locator('section[aria-label="Check run summary"]'),
  ).toBeHidden();
  const tabs = await page.locator(".ae-job-detail-tabs").boundingBox();
  const details = await page.locator(".ae-job-inspector-details").boundingBox();
  expect(details?.y).toBe((tabs?.y ?? 0) + (tabs?.height ?? 0) + 8);
  expect(
    await page
      .locator(".PageLayout-content")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe("rgb(13, 17, 22)");
});

test("steps table fits narrow panels and truncates long names", async ({
  page,
}) => {
  const styles = await readFile(
    path.resolve("entrypoints/actions.content/run-views.css"),
    "utf8",
  );
  const longName = "Run extremely long step command ".repeat(30);
  const longJob = "matrix/job-without-any-break-opportunities".repeat(10);
  await page.setContent(`
    <style>
      * { box-sizing: border-box }
      body { margin: 0 }
      .ae-run-views { width: 100% }
      ${styles}
    </style>
    <div class="ae-run-views">
      <section class="ae-run-table">
        <div class="ae-run-table-scroll">
          <table>
            <caption>2 steps from 1 loaded job. Not all jobs may be loaded.</caption>
            <thead><tr><th>Job</th><th>Step</th><th>Status</th><th>Duration</th></tr></thead>
            <tbody>
              <tr><td title="${longJob}">${longJob}</td><td><a href="#step" title="${longName}">${longName}</a></td><td>In progress</td><td>12m 34s</td></tr>
              <tr><td title="${longJob}">${longJob}</td><td colspan="3" role="alert">${"FailedToLoadSteps".repeat(50)} <button>Retry</button></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `);
  for (const width of [1000, 660, 358, 300]) {
    await page.setViewportSize({ width, height: 800 });
    const table = page.getByRole("table");
    const bounds = await table.boundingBox();
    expect(bounds?.width).toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const step = page.locator('a[href="#step"]');
    await expect(step).toHaveAttribute("title", longName);
    expect(
      await step.evaluate((element) => ({
        clipped: element.scrollWidth > element.clientWidth,
        overflow: getComputedStyle(element).textOverflow,
        nowrap: getComputedStyle(element).whiteSpace,
      })),
    ).toEqual({ clipped: true, overflow: "ellipsis", nowrap: "nowrap" });
    const status = await page
      .locator("tbody tr")
      .first()
      .locator("td")
      .nth(2)
      .boundingBox();
    expect(status?.width).toBe(72);
    expect(await step.evaluate((element) => element.clientHeight)).toBeLessThan(
      30,
    );
  }
});

test("native jobs switch without document reload and view tabs stay fixed above scrolling content", async ({}, testInfo) => {
  test.skip(!process.env.LIVE_GITHUB, "Opt in to public GitHub access.");
  test.setTimeout(60_000);
  const profile = await mkdtemp(path.join(tmpdir(), "ae-workspace-"));
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
    const page = await context.newPage();
    await page.goto(
      "https://github.com/vercel/next.js/actions/runs/40445406380/job/121995389580?ae_view=table",
    );
    const experience = page.locator("#ae-run-experience");
    const tabs = page.getByRole("navigation", {
      name: "Run views",
      exact: true,
    });
    await expect(experience.getByRole("table")).toBeVisible({
      timeout: 20_000,
    });
    const headerActions = await page
      .locator(".ae-run-detail-action")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => {
          const bounds = anchor.getBoundingClientRect();
          const icon = anchor.querySelector("svg")?.getBoundingClientRect();
          return {
            x: bounds.x,
            y: bounds.y,
            right: bounds.right,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
            icon: icon
              ? { x: icon.x, y: icon.y, right: icon.right, bottom: icon.bottom }
              : null,
          };
        }),
      );
    expect(headerActions).toHaveLength(3);
    for (const [index, action] of headerActions.entries()) {
      expect(action.width).toBe(32);
      expect(action.height).toBe(32);
      expect(action.icon?.x).toBeGreaterThanOrEqual(action.x);
      expect(action.icon?.right).toBeLessThanOrEqual(action.right);
      expect(action.icon?.y).toBeGreaterThanOrEqual(action.y);
      expect(action.icon?.bottom).toBeLessThanOrEqual(action.bottom);
      if (index > 0)
        expect(action.x).toBeGreaterThanOrEqual(
          headerActions[index - 1]?.right ?? 0,
        );
    }
    await expect(page.locator(".ae-job-controls")).toHaveCount(0);
    const details = page.getByRole("tablist", { name: "Job details" });
    await expect(
      details.getByRole("tab", { name: "Log", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const annotation = page.locator(
      '.PageLayout-content [role="region"][aria-label="Annotations"]',
    );
    await expect(annotation).toBeHidden();
    await expect(details.locator('[data-component="CounterLabel"]')).toHaveText(
      "1",
    );
    await details.getByRole("tab", { name: /^Annotations/ }).click();
    await expect(annotation).toBeVisible();
    await expect(
      page.locator(".PageLayout-content .js-check-steps"),
    ).toBeHidden();
    await details.getByRole("tab", { name: /^Annotations/ }).press("Home");
    await expect(
      details.getByRole("tab", { name: "Log", exact: true }),
    ).toBeFocused();
    await expect(annotation).toBeHidden();
    await experience.evaluate((element) =>
      element.setAttribute("data-instance", "retained"),
    );
    await page
      .locator(".PageLayout-pane")
      .evaluate((element) =>
        element.setAttribute("data-pane-instance", "retained"),
      );
    await page.evaluate(() =>
      document.documentElement.setAttribute(
        "data-document-instance",
        "retained",
      ),
    );
    const top = await tabs.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    const header = await page.locator(".PageLayout-header").boundingBox();
    const leftTabs = await tabs.boundingBox();
    const rightTabs = await details.boundingBox();
    if (!header || !leftTabs || !rightTabs)
      throw new Error("Missing workspace header.");
    expect(header.height).toBeLessThanOrEqual(56);
    expect(Math.abs(leftTabs.y - rightTabs.y)).toBeLessThanOrEqual(1);
    expect(leftTabs.y - (header.y + header.height)).toBeLessThanOrEqual(8);
    expect(leftTabs.height).toBeLessThanOrEqual(40);
    await page.locator(".ae-run-view-content").evaluate((element) => {
      element.scrollTop = 500;
    });
    expect(
      await tabs.evaluate((element) => element.getBoundingClientRect().top),
    ).toBeCloseTo(top, 0);
    await expect
      .poll(() =>
        page
          .locator(".ae-run-view-content")
          .evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(0);
    await page.locator(".ae-run-view-content").evaluate((element) => {
      element.scrollTop = 0;
    });
    const other = experience
      .locator("tbody a")
      .filter({ hasText: "Cancel previous runs" });
    const target = (await other.count())
      ? other.first()
      : experience.locator("tbody a").first();
    const original = page.url();
    const next = new URL((await target.getAttribute("href")) ?? "", original)
      .href;
    await target.click();
    await expect(page).toHaveURL(next);
    await expect(
      page.locator("section[aria-label='Check run summary']").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(experience).toHaveAttribute("data-instance", "retained");
    await expect(page.locator(".PageLayout-pane")).toHaveAttribute(
      "data-pane-instance",
      "retained",
    );
    expect(
      await tabs.evaluate((element) => element.getBoundingClientRect().top),
    ).toBeCloseTo(top, 0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-document-instance",
      "retained",
    );
    await expect(experience.getByRole("table")).toBeVisible();
    await expect(
      details.getByRole("tab", { name: "Log", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page).toHaveURL(original);
    await expect(experience).toHaveAttribute("data-instance", "retained");
    await page.goForward();
    await expect(page).toHaveURL(next);
    await expect(experience).toHaveAttribute("data-instance", "retained");
    await tabs.getByRole("link", { name: "List", exact: true }).click();
    const nativeSelected = page.locator(
      `nav[aria-label="Workflow run"] a[href="${new URL(next).pathname}"]`,
    );
    await expect(nativeSelected).toHaveAttribute("aria-current", "page");
    await expect(nativeSelected.locator("..")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(nativeSelected.locator("..")).toHaveClass(
      /ActionListItem--navActive/,
    );
    await tabs.getByRole("link", { name: "Table", exact: true }).click();
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-color-mode", "dark");
      document.documentElement.setAttribute("data-dark-theme", "dark");
    });
    await page.screenshot({ path: testInfo.outputPath("workspace-dark.png") });
    await details.getByRole("tab", { name: /^Annotations/ }).click();
    await page.screenshot({
      path: testInfo.outputPath("workspace-annotations-dark.png"),
    });
    await details.getByRole("tab", { name: "Log", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(tabs).toBeVisible();
    const paneBounds = await page.locator(".PageLayout-pane").boundingBox();
    const contentBounds = await page
      .locator(".PageLayout-content")
      .boundingBox();
    expect(paneBounds).not.toBeNull();
    expect(contentBounds).not.toBeNull();
    if (!paneBounds || !contentBounds)
      throw new Error("Missing mobile layout.");
    expect(paneBounds.x).toBeGreaterThanOrEqual(0);
    expect(paneBounds.x + paneBounds.width).toBeLessThanOrEqual(391);
    expect(contentBounds.y).toBeGreaterThanOrEqual(
      paneBounds.y + paneBounds.height,
    );
    await page.screenshot({
      path: testInfo.outputPath("workspace-narrow.png"),
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});

test("log pane switches side, below, maximized, fullscreen and closed without replacing native logs", async ({}, testInfo) => {
  test.skip(!process.env.LIVE_GITHUB, "Opt in to public GitHub access.");
  test.setTimeout(60_000);
  const profile = await mkdtemp(path.join(tmpdir(), "ae-layout-"));
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
    const page = await context.newPage();
    const job = "/vercel/next.js/actions/runs/40445406380/job/121995389580";
    await page.goto(`https://github.com${job}?ae_view=table`);
    const pane = page.locator(".PageLayout-pane");
    const content = page.locator(".PageLayout-content");
    const layout = page.locator("split-page-layout");
    const group = page.getByRole("group", { name: "Log layout" });
    const choice = (name: string) =>
      group.getByRole("button", { name, exact: true });
    await expect(
      page.locator("#ae-run-experience").getByRole("table"),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(choice("Logs beside jobs")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page
      .locator(".PageLayout-content .js-check-steps")
      .first()
      .evaluate((element) =>
        element.setAttribute("data-log-instance", "retained"),
      );
    await pane.evaluate((element) =>
      element.setAttribute("data-pane-instance", "retained"),
    );
    const box = async (locator: typeof pane) => {
      const value = await locator.boundingBox();
      if (!value) throw new Error("Missing layout box.");
      return value;
    };
    const retained = async () => {
      await expect(page.locator('[data-log-instance="retained"]')).toHaveCount(
        1,
      );
      await expect(pane).toHaveAttribute("data-pane-instance", "retained");
      await expect(
        page.locator(`nav[aria-label="Workflow run"] a[href="${job}"]`),
      ).toHaveAttribute("aria-current", "page");
      expect(new URL(page.url()).pathname).toBe(job);
      expect(new URL(page.url()).searchParams.get("ae_view")).toBe("table");
    };
    const side = [await box(pane), await box(content)] as const;
    expect(side[0].x + side[0].width).toBeLessThanOrEqual(side[1].x + 1);

    await choice("Logs below jobs").click();
    await expect(layout).toHaveAttribute("data-ae-log-layout", "below");
    await expect(page).toHaveURL(/ae_layout=below/);
    const below = [await box(pane), await box(content)] as const;
    expect(below[1].y).toBeGreaterThanOrEqual(below[0].y + below[0].height - 1);
    expect(below[1].width).toBeGreaterThan(1000);
    await retained();
    await page.screenshot({ path: testInfo.outputPath("layout-below.png") });

    await choice("Maximize logs").click();
    await expect(layout).toHaveAttribute("data-ae-log-layout", "maximized");
    await expect(pane).toBeHidden();
    expect((await box(content)).width).toBeGreaterThan(1000);
    await retained();

    await choice("Fullscreen logs").click();
    await expect(layout).toHaveAttribute("data-ae-log-layout", "fullscreen");
    const full = await box(content);
    expect(full.x).toBe(0);
    expect(full.y).toBe(0);
    expect(full.width).toBe(1440);
    expect(full.height).toBe(1000);
    await expect(
      page.getByRole("tablist", { name: "Job details" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("layout-fullscreen.png"),
    });
    await page.keyboard.press("Escape");
    await expect(layout).toHaveAttribute("data-ae-log-layout", "maximized");
    await choice("Logs beside jobs").click();
    await expect(layout).toHaveAttribute("data-ae-log-layout", "side");
    await expect(page).not.toHaveURL(/ae_layout=/);

    await content.evaluate((element) => {
      element.scrollTop = 200;
    });
    const scroll = await content.evaluate((element) => element.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    // Avoid Playwright's actionability scroll, which would reset the pane being measured.
    await page
      .getByRole("button", { name: "Close logs" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(layout).toHaveAttribute("data-ae-log-layout", "closed");
    await expect(content).toBeHidden();
    expect((await box(pane)).width).toBeGreaterThan(1000);
    await expect(page.getByRole("button", { name: "Show logs" })).toHaveCount(
      0,
    );
    await retained();
    await page.screenshot({ path: testInfo.outputPath("layout-closed.png") });
    await pane.locator("tbody a").first().click();
    await expect(layout).toHaveAttribute("data-ae-log-layout", "side");
    await expect(content).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-color-mode", "dark");
      document.documentElement.setAttribute("data-dark-theme", "dark");
    });
    await page.screenshot({
      path: testInfo.outputPath("layout-side-dark.png"),
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});
