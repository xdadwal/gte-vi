import { test, expect } from "@playwright/test";
import { ll, xy, REPORT_CELL_METERS } from "../src/model";
import type { Incident } from "../src/model";

test("severity hotspots retain star labels and pending state across viewports", async ({
  page,
}) => {
  const point = xy(77.209, 28.6139);
  const originX = Math.floor(point.x / REPORT_CELL_METERS),
    originY = Math.floor(point.y / REPORT_CELL_METERS);
  const incidents: Incident[] = [1, 2, 3, 4, 5, 0].map((stars, index) => {
    const x = originX + (index % 3) * 2,
      y = originY + Math.floor(index / 3) * 2;
    const buffer = stars === 0 ? 100 : stars * 100;
    const ring = [
      [(x + 1) * REPORT_CELL_METERS, y * REPORT_CELL_METERS, -Math.PI / 2],
      [(x + 1) * REPORT_CELL_METERS, (y + 1) * REPORT_CELL_METERS, 0],
      [x * REPORT_CELL_METERS, (y + 1) * REPORT_CELL_METERS, Math.PI / 2],
      [x * REPORT_CELL_METERS, y * REPORT_CELL_METERS, Math.PI],
    ].flatMap(([a, b, start]) =>
      Array.from({ length: 9 }, (_, step) => {
        const angle = start + (step * Math.PI) / 16;
        return ll(a + Math.cos(angle) * buffer, b + Math.sin(angle) * buffer);
      }),
    );
    ring.push(ring[0]);
    return {
      id: `visual-${stars}`,
      cell: `${x}:${y}`,
      status: stars === 0 ? "pending" : "active",
      average: stars,
      count: stars === 0 ? 2 : 5,
      buffer,
      revision: 1,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1800000).toISOString(),
      geometry: { type: "Polygon", coordinates: [ring] },
      hotzone: { type: "Polygon", coordinates: [ring] },
    };
  });
  await page.route("**/api/v1/snapshot?**", (route) =>
    route.fulfill({
      json: {
        incidents,
        refuges: [],
        overview: [],
        serverTime: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/v1/events?**", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify({ incidents, refuges: [], serverTime: new Date().toISOString() })}\n\n`,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /expression|layer|paint/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto("/");
  // Markers are installed after MapLibre loads the external style, sprites,
  // tiles and glyphs. Allow a cold network/browser context to finish loading.
  for (const stars of [1, 2, 3, 4, 5])
    await expect(
      page.getByRole("button", {
        name: `Incident ${stars.toFixed(1)} stars, 5 reports`,
        exact: true,
      }),
    ).toBeAttached({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Pending incident, 2 reports" }),
  ).toBeAttached();
  expect(
    await page
      .locator(".map-label:not(.overview-label)")
      .evaluateAll(
        (elements) =>
          new Set(
            elements.map((element) =>
              (element as HTMLElement).style.getPropertyValue(
                "--severity-color",
              ),
            ),
          ).size,
      ),
  ).toBe(6);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: "../artifacts/screenshots/hotspots-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: "../artifacts/screenshots/hotspots-mobile.png",
  });
  // The invisible footprint remains selectable away from the star marker.
  const marker = await page
    .getByRole("button", { name: "Incident 5.0 stars, 5 reports", exact: true })
    .boundingBox();
  expect(marker).not.toBeNull();
  await page.mouse.click(
    marker!.x + marker!.width / 2,
    marker!.y + marker!.height + 12,
  );
  await expect(
    page.getByRole("heading", { name: "Reported area", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
