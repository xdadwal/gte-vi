import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../src/settings-values";
import { ll, xy, REPORT_CELL_METERS, type Incident } from "../src/model";

const point = xy(77.209, 28.6139);
const x = Math.floor(point.x / REPORT_CELL_METERS);
const y = Math.floor(point.y / REPORT_CELL_METERS);
const center = ll(
  (x + 1.5) * REPORT_CELL_METERS,
  (y + 0.5) * REPORT_CELL_METERS,
);
function incidentAt(index: number, stars: number): Incident {
  const ring = [
    [x + index, y],
    [x + index + 1, y],
    [x + index + 1, y + 1],
    [x + index, y + 1],
    [x + index, y],
  ].map(([a, b]) => ll(a * REPORT_CELL_METERS, b * REPORT_CELL_METERS));
  return {
    id: `layout-${index}`,
    cell: `${x + index}:${y}`,
    status: stars ? "active" : "pending",
    average: stars,
    count: 8,
    buffer: 0,
    revision: 1,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    geometry: { type: "Polygon", coordinates: [ring] },
    hotzone: { type: "Polygon", coordinates: [ring] },
  };
}
const incidents = [0, 3, 5].map((stars, index) => incidentAt(index, stars));

async function fixtures(
  page: Page,
  zoom: number,
  areas: Incident[] = incidents,
) {
  await page.route("https://tiles.openfreemap.org/styles/positron", (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#eeeae1" },
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/settings", (route) =>
    route.fulfill({
      json: {
        revision: 100,
        values: {
          ...DEFAULT_SETTINGS,
          pollingSeconds: 30,
          reconnectMinSeconds: 30,
          reconnectMaxSeconds: 60,
          mapLon: center[0],
          mapLat: center[1],
          mapZoom: zoom,
        },
      },
    }),
  );
  const snapshot = {
    incidents: areas,
    refuges: [],
    serverTime: new Date().toISOString(),
  };
  await page.route("**/api/v1/snapshot?**", (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        overview:
          new URL(route.request().url()).searchParams.get("overview") === "true"
            ? [{ lon: center[0], lat: center[1], count: 12 }]
            : [],
      },
    }),
  );
  await page.route("**/api/v1/events?**", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    }),
  );
}

for (const width of [320, 390, 768, 1440])
  test(`labels group without overlap and separate when tapped at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixtures(page, 14);
    await page.goto("/");
    const group = page.getByRole("button", {
      name: "3 reported areas. Zoom to inspect",
      exact: true,
    });
    await expect(group).toBeVisible();
    await expect(page.locator(".map-label:not(.overview-label)")).toHaveCount(
      0,
    );
    await group.click();
    const pending = page.getByRole("button", {
      name: "Pending incident, 8 reports",
      exact: true,
    });
    await expect(pending).toBeVisible();
    await expect(page.locator(".overview-label")).toHaveCount(0);
    await expect
      .poll(async () =>
        page.locator(".map-label").evaluateAll((elements) => {
          const boxes = elements.map((e) => e.getBoundingClientRect());
          return boxes.every((a, i) =>
            boxes
              .slice(i + 1)
              .every(
                (b) =>
                  a.right <= b.left ||
                  b.right <= a.left ||
                  a.bottom <= b.top ||
                  b.bottom <= a.top,
              ),
          );
        }),
      )
      .toBe(true);
    await pending.click({ trial: true });
    await page.screenshot({
      path: `../artifacts/screenshots/marker-layout-${width}.png`,
    });
    await pending.click();
    await expect(
      page.getByRole("heading", { name: "Reported area", exact: true }),
    ).toBeVisible();
  });

test("wide overview counts never share the map with individual severity labels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page, 9);
  await page.goto("/");
  const overview = page.getByRole("button", {
    name: "12 reported areas. Zoom to inspect",
    exact: true,
  });
  await expect(overview).toBeVisible();
  await expect(page.locator(".map-label:not(.overview-label)")).toHaveCount(0);
  await overview.click();
  await expect(overview).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "3 reported areas. Zoom to inspect",
      exact: true,
    }),
  ).toBeVisible();
});

test("rotating a close map regroups badges before they overlap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page, 14.7);
  await page.goto("/");
  await expect(page.locator(".map-label:not(.overview-label)")).toHaveCount(3);
  // Hold the fixture stable: the gesture must regroup without a new snapshot.
  await page.route("**/api/v1/snapshot?**", (route) => route.abort());
  await page.route("**/api/v1/events?**", (route) => route.abort());
  await page.mouse.move(195, 200);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(285, 200, { steps: 10 });
  await expect(
    page.getByRole("button", {
      name: "3 reported areas. Zoom to inspect",
      exact: true,
    }),
  ).toBeVisible({ timeout: 1000 });
  await page.mouse.up({ button: "right" });
});

test("dense chains zoom progressively around the tapped group", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const areas = [0, 3, 5, 2, 4].map((stars, index) => incidentAt(index, stars));
  await fixtures(page, 14, areas);
  await page.goto("/");
  const group = page.getByRole("button", {
    name: "5 reported areas. Zoom to inspect",
    exact: true,
  });
  await expect(group).toBeVisible();
  await group.click();
  await expect(page.locator(".map-label:not(.overview-label)")).toHaveCount(5);
  const anchor = page.getByRole("button", {
    name: "Incident 5.0 stars, 8 reports",
    exact: true,
  });
  await expect(anchor).toBeInViewport();
  await anchor.click();
  await expect(
    page.getByRole("heading", { name: "Reported area", exact: true }),
  ).toBeVisible();
});
