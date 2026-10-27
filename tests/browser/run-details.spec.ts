import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

test("workflow homepage separates native PR summary, annotations and artifacts", async ({}, testInfo) => {
  test.skip(!process.env.LIVE_GITHUB, "Opt in to public GitHub access.");
  const profile = await mkdtemp(path.join(tmpdir(), "ae-run-details-"));
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
      "https://github.com/vercel/next.js/actions/runs/40445406380/",
    );
    const tabs = page.getByRole("navigation", { name: "Run views" });
    await expect(tabs).toBeVisible();
    await expect(page.locator(".PageLayout-content")).toBeHidden();
    const paneBounds = await page.locator(".PageLayout-pane").boundingBox();
    const columnsBounds = await page
      .locator(".PageLayout-columns")
      .boundingBox();
    expect(paneBounds?.width).toBeGreaterThan(
      (columnsBounds?.width ?? 0) * 0.9,
    );
    const summary = page.locator(
      '.PageLayout-pane [role="region"][aria-label="Workflow run summary"]',
    );
    const annotation = page.locator(
      '.PageLayout-pane [role="region"][aria-label="Annotations"]',
    );
    const artifacts = page.locator(
      '.PageLayout-pane [role="region"][aria-label="Artifacts"]',
    );
    await tabs.getByRole("link", { name: "Summary", exact: true }).click();
    await expect(summary).toBeVisible();
    await expect(annotation).toBeHidden();
    await expect(artifacts).toBeHidden();
    await summary.evaluate((element) =>
      element.setAttribute("data-instance", "retained"),
    );
    await tabs.getByRole("link", { name: /^Annotations/ }).click();
    await expect(annotation).toBeVisible();
    await expect(summary).toBeHidden();
    await expect(artifacts).toBeHidden();
    await expect(
      tabs.getByRole("link", { name: /^Annotations/ }).locator(".Counter"),
    ).toHaveText("7");
    await tabs.getByRole("link", { name: /^Artifacts/ }).click();
    await expect(artifacts).toBeVisible();
    await expect(annotation).toBeHidden();
    await expect(
      tabs.getByRole("link", { name: /^Artifacts/ }).locator(".Counter"),
    ).toHaveText("3");
    await tabs.getByRole("link", { name: "Summary", exact: true }).click();
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("data-instance", "retained");
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-color-mode", "dark");
      document.documentElement.setAttribute("data-dark-theme", "dark");
    });
    await page.screenshot({
      path: testInfo.outputPath("workflow-summary-dark.png"),
    });
    await tabs.getByRole("link", { name: /^Artifacts/ }).click();
    await page.screenshot({
      path: testInfo.outputPath("workflow-artifacts-dark.png"),
    });
  } finally {
    await context.close();
    await rm(profile, { recursive: true });
  }
});
