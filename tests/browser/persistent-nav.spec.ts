import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { type BrowserContext, test as base, expect } from "@playwright/test";

const run = "/acme/widget/actions/runs/102";
const test = base.extend<{ extension: BrowserContext }>({
  extension: async ({ playwright }, use) => {
    const profile = path.resolve(".playwright-profiles", randomUUID());
    await mkdir(profile, { recursive: true });
    const extensionPath = path.resolve(".output/chrome-mv3");
    const context = await playwright.chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    try {
      await context.route("https://github.com/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native jobs</title></head><body>
          <style>
          .PageLayout-pane{height:600px;width:300px;overflow:auto}
          nav li{min-height:36px}
          .padding{height:1500px}
          </style>
          <h1>Native run</h1><aside class="PageLayout-pane">
          <nav aria-label="Workflow run"><ul>${Array.from(
            { length: 40 },
            (_, index) => {
              const id = index + 1;
              return `<li><a href="${run}/job/${id}"><svg class="octicon octicon-${id === 20 || id === 35 ? "x-circle-fill" : "check-circle-fill"}"></svg><span data-component="ActionList.Item.Label">job ${id}</span></a></li>`;
            },
          ).join("")}</ul></nav><div class="padding"></div></aside>
          <div class="PageLayout-content"><div id="native-logs">Native logs</div><div id="native-graph">Native graph</div></div>
          </body></html>`,
        }),
      );
      await use(context);
    } finally {
      await context.close();
      await rm(profile, { recursive: true });
    }
  },
});

test("ae_job selection survives filtering, refresh, and back-forward", async ({
  extension,
}) => {
  const page = await extension.newPage();
  await page.goto(`https://github.com${run}?ae_view=graph&ae_job=1`);
  const controls = page.getByRole("region", { name: "Extra Actions controls" });
  const nav = page.getByRole("navigation", {
    name: "Workflow run",
    exact: true,
  });
  await controls.getByRole("searchbox").fill("job");
  await controls.getByRole("combobox").selectOption("failure");
  await expect(
    nav.getByRole("link", { name: "job 1", exact: true }),
  ).toBeVisible();
  await expect(
    controls.getByText("current job kept visible", { exact: false }),
  ).toBeVisible();
  await controls
    .getByRole("link", { name: "Next failed job", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${run}/job/20\\?ae_view=graph$`));
  await expect(controls.getByText("Failure 1 of 2")).toBeVisible();
  await expect(controls.getByRole("combobox")).toHaveValue("failure");
  await controls
    .getByRole("link", { name: "Next failed job", exact: true })
    .click();
  await expect(controls.getByText("Failure 2 of 2")).toBeVisible();
  await page.goBack();
  await expect(controls.getByText("Failure 1 of 2")).toBeVisible();
  await page.reload();
  await expect(controls.getByRole("combobox")).toHaveValue("failure");
  await expect(controls.getByRole("searchbox")).toHaveValue("job");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${run}\\?ae_view=graph&ae_job=1$`));
  await expect(
    nav.getByRole("link", { name: "job 1", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(controls.getByText("Failure 1 of 2")).toBeVisible();
  await expect(page.locator("#native-logs")).toBeVisible();
  await expect(page.locator("#native-graph")).toBeVisible();
});

test("native normal and modified clicks retain view context without permanent href rewrites", async ({
  extension,
}) => {
  const page = await extension.newPage();
  await page.goto(`https://github.com${run}?ae_view=graph&ae_job=1`);
  const nav = page.getByRole("navigation", {
    name: "Workflow run",
    exact: true,
  });
  const native = nav.getByRole("link", { name: "job 2", exact: true });
  await expect(
    page.getByRole("region", { name: "Extra Actions controls" }),
  ).toBeVisible();
  await expect(native).toHaveAttribute("href", `${run}/job/2`);
  const popupPromise = extension.waitForEvent("page");
  await native.click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupPromise;
  await popup.waitForURL(new RegExp(`${run}/job/2\\?ae_view=graph$`));
  await expect(native).toHaveAttribute("href", `${run}/job/2`);
  await expect(page).toHaveURL(new RegExp(`ae_job=1$`));
  await popup.close();
  await native.click();
  await expect(page).toHaveURL(new RegExp(`${run}/job/2\\?ae_view=graph$`));
});

test("keeps scroll on native replacement and live status changes, with mobile controls", async ({
  extension,
}) => {
  const page = await extension.newPage();
  await page.goto(`https://github.com${run}`);
  const controls = page.getByRole("region", { name: "Extra Actions controls" });
  const pane = page.locator(".PageLayout-pane");
  await expect(controls).toBeVisible();
  await pane.evaluate((element) => {
    element.scrollTop = 320;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem("actions-enhanced:job-navigation") ?? "{}",
          ).scrollTop,
      ),
    )
    .toBe(320);
  await page.evaluate(() => {
    const native = document.querySelector(".PageLayout-pane");
    const replacement = native?.cloneNode(true);
    if (!(replacement instanceof HTMLElement)) throw new Error("Missing pane");
    replacement.querySelector("[data-actions-enhanced]")?.remove();
    native?.replaceWith(replacement);
  });
  await expect(controls).toBeVisible();
  await expect
    .poll(() => pane.evaluate((element) => element.scrollTop))
    .toBe(320);
  await page.evaluate(() => {
    document
      .querySelector("nav a svg")
      ?.setAttribute("class", "octicon octicon-clock");
  });
  await expect
    .poll(() => controls.getByRole("combobox").textContent())
    .toContain("Running / queued (1)");
  await expect
    .poll(() => pane.evaluate((element) => element.scrollTop))
    .toBe(320);
  await page.setViewportSize({ width: 390, height: 844 });
  await pane.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    controls.getByRole("searchbox", { name: "Filter loaded jobs" }),
  ).toBeVisible();
  await controls.getByRole("searchbox").fill("job 20");
  await controls.getByRole("searchbox").press("Enter");
  await expect(
    page
      .getByRole("navigation", { name: "Workflow run", exact: true })
      .getByRole("link", { name: "job 20", exact: true }),
  ).toBeFocused();
});
