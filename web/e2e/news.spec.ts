import { test, expect } from "@playwright/test";

test("news locations expose dated sources without becoming community reports", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-11T03:00:00Z"));
  await page.route("**/api/v1/snapshot?**", (route) =>
    route.fulfill({
      json: {
        incidents: [],
        refuges: [],
        overview: [],
        serverTime: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/v1/events?**", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify({ incidents: [], refuges: [], serverTime: new Date().toISOString() })}\n\n`,
    }),
  );
  await page.goto("/");
  await expect(page.locator(".news-marker").first()).toBeVisible();
  await expect(
    page.getByText("No current reports nearby", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "7 news locations today" }).click();
  await page
    .getByRole("button", { name: "Jantar Mantar 11 Oct protest call" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Jantar Mantar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Unrated; no proximity alerts or route restrictions/),
  ).toBeVisible();
  await expect(page.getByText(/Published 11 Oct 2026/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Read NDTV coverage" }),
  ).toHaveAttribute("href", /ndtv\.com/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "../artifacts/screenshots/news-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const pin = page.getByRole("button", {
    name: "News: Jantar Mantar",
    exact: true,
  });
  await expect(pin).toBeVisible();
  const pinBounds = await pin.boundingBox();
  const panelBounds = await page
    .getByRole("region", { name: "Map controls" })
    .boundingBox();
  expect(pinBounds!.y + pinBounds!.height).toBeLessThan(panelBounds!.y);
  await page.screenshot({ path: "../artifacts/screenshots/news-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("expired news leaves the map and remains explicitly archived in the source panel", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-12T03:00:00Z"));
  await page.goto("/");
  await expect(page.locator(".news-marker")).toHaveCount(0);
  await page.getByRole("button", { name: "Previous news coverage" }).click();
  await page
    .getByRole("button", { name: "Jantar Mantar 11 Oct protest call" })
    .click();
  await expect(
    page.getByText("NEWS / ARCHIVED", { exact: true }),
  ).toBeVisible();
});
