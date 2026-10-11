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
  const snapshotFor = (url: string) => {
    const query = new URL(url).searchParams;
    const cells = new Set((query.get("cells") || "").split(","));
    return {
      incidents: areas.filter((area) => cells.has(area.cell)),
      refuges: [],
      serverTime: new Date().toISOString(),
      ...(query.get("overview") === "true" ? { overview: areas } : {}),
    };
  };
  await page.route("**/api/v1/snapshot?**", (route) =>
    route.fulfill({ json: snapshotFor(route.request().url()) }),
  );
  await page.route("**/api/v1/events?**", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify(snapshotFor(route.request().url()))}\n\n`,
    }),
  );
}

for (const width of [320, 390, 768, 1440])
  test(`individual badges shrink with zoom without counts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixtures(page, 14);
    await page.goto("/");
    const pending = page.getByRole("button", {
      name: "Pending incident, 8 reports",
      exact: true,
    });
    await expect(pending).toBeVisible();
    await expect(page.locator(".map-label")).toHaveCount(3);
    await expect(page.locator(".overview-label")).toHaveCount(0);
    const activeBadge = page
      .getByRole("button", {
        name: "Incident 3.0 stars, 8 reports",
        exact: true,
      })
      .locator(".map-badge");
    await expect
      .poll(async () => (await activeBadge.boundingBox())?.width)
      .toBeCloseTo(44.8, 0);
    await expect
      .poll(async () => (await activeBadge.boundingBox())?.height)
      .toBeCloseTo(30.8, 0);
    const target = await pending.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect
      .poll(async () => (await activeBadge.boundingBox())?.width)
      .toBeCloseTo(41.81, 1);
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect
      .poll(async () => (await activeBadge.boundingBox())?.width)
      .toBeCloseTo(38.83, 1);
    await expect(page.locator(".map-label")).toHaveCount(3);
    await expect(page.locator(".overview-label")).toHaveCount(0);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect
      .poll(async () => (await activeBadge.boundingBox())?.width)
      .toBeCloseTo(41.81, 1);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect
      .poll(async () => (await activeBadge.boundingBox())?.width)
      .toBeCloseTo(44.8, 0);
    const inspect = width >= 768 ? activeBadge.locator("..") : pending;
    await inspect.click({ trial: true });
    await page.screenshot({
      path: `../artifacts/screenshots/marker-layout-${width}.png`,
    });
    await inspect.click();
    await expect(
      page.getByRole("heading", { name: "Reported area", exact: true }),
    ).toBeVisible();
  });

for (const width of [390, 1440])
  for (const zoom of [0, 5, 9, 11])
    test(`wide zoom ${zoom} at ${width}px loads individual ratings without location or count badges`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await fixtures(page, zoom);
      await page.goto("/");
      const badge = page.getByRole("button", {
        name: "Incident 5.0 stars, 8 reports",
        exact: true,
      });
      await expect(badge).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Pending incident, 8 reports",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".map-label")).toHaveCount(3);
      await expect(page.locator(".overview-label")).toHaveCount(0);
      await badge.focus();
      const handle = await badge.elementHandle();
      await page.waitForTimeout(1200);
      expect(
        await handle!.evaluate(
          (element) =>
            element.isConnected && document.activeElement === element,
        ),
      ).toBe(true);
      await expect(
        page.getByText("3 reported areas on this map", { exact: true }),
      ).toBeVisible();
      await badge.click();
      await expect(
        page.getByRole("heading", { name: "5.0 ★", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("This incident has expired or been removed."),
      ).toHaveCount(0);
      if (zoom === 9)
        await page.screenshot({
          path: `../artifacts/screenshots/wide-stars-${width}.png`,
        });
    });

test("dense areas retain every rating without a count badge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const areas = [0, 3, 5, 2, 4].map((stars, index) => incidentAt(index, stars));
  await fixtures(page, 14, areas);
  await page.goto("/");
  await expect(page.locator(".map-label")).toHaveCount(5);
  await expect(page.locator(".overview-label")).toHaveCount(0);
});

test("public map pauses location following while exploring and resumes with Locate me", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    longitude: center[0],
    latitude: center[1],
    accuracy: 10,
  });
  await fixtures(page, 14);
  await page.route("**/api/v1/settings", (route) =>
    route.fulfill({
      json: {
        revision: 100,
        values: {
          ...DEFAULT_SETTINGS,
          mapLon: center[0] + 0.04,
          mapLat: center[1] + 0.04,
          mapZoom: 14,
        },
      },
    }),
  );
  await page.goto("/");
  const badge = page.getByRole("button", {
    name: "Incident 3.0 stars, 8 reports",
    exact: true,
  });
  const horizontalOffset = async () => {
    const label = await badge.boundingBox();
    const map = await page.locator(".map-view").boundingBox();
    return label && map
      ? Math.abs(label.x + label.width / 2 - map.x - map.width / 2)
      : Infinity;
  };
  await expect.poll(horizontalOffset).toBeLessThan(3);
  // Exploring should pause follow, so GPS updates do not pull the map back.
  await page.mouse.move(195, 350);
  await page.mouse.down();
  await page.mouse.move(295, 350, { steps: 10 });
  await page.mouse.up();
  await expect.poll(horizontalOffset).toBeGreaterThan(40);
  await badge.click({ trial: true });
  await context.setGeolocation({
    longitude: center[0] + 0.00001,
    latitude: center[1],
    accuracy: 8,
  });
  await page.waitForTimeout(500);
  expect(await horizontalOffset()).toBeGreaterThan(40);
  await page.getByRole("button", { name: "Ack", exact: true }).click();
  await page.getByRole("button", { name: "Locate me", exact: true }).click();
  await expect.poll(horizontalOffset).toBeLessThan(3);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const visualBadge = badge.locator(".map-badge");
  await expect
    .poll(async () => (await visualBadge.boundingBox())?.width)
    .toBeCloseTo(41.81, 1);
  await context.setGeolocation({
    longitude: center[0] + 0.00002,
    latitude: center[1],
    accuracy: 7,
  });
  await expect.poll(horizontalOffset).toBeLessThan(3);
  await expect
    .poll(async () => (await visualBadge.boundingBox())?.width)
    .toBeCloseTo(41.81, 1);
});

test("delayed settings set the initial view when location is denied", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(_success: unknown, error: (e: { code: number }) => void) {
          setTimeout(() => error({ code: 1 }), 0);
          return 1;
        },
        clearWatch() {},
      },
    });
  });
  await fixtures(page, 14);
  await page.route("**/api/v1/settings", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fallback();
  });
  await page.goto("/");
  const badge = page.getByRole("button", {
    name: "Incident 3.0 stars, 8 reports",
    exact: true,
  });
  await expect
    .poll(async () => (await badge.locator(".map-badge").boundingBox())?.width)
    .toBeCloseTo(44.8, 0);
  await expect
    .poll(async () => {
      const label = await badge.boundingBox();
      const map = await page.locator(".map-view").boundingBox();
      return label && map
        ? Math.abs(label.x + label.width / 2 - map.x - map.width / 2)
        : Infinity;
    })
    .toBeLessThan(3);
  await expect(page.getByText(/Location access is blocked/)).toBeVisible();
});

for (const width of [320, 390, 1440])
  test(`refresh control loads fresh map data without moving the camera at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixtures(page, 14);
    await page.goto("/");
    const oldBadge = page.getByRole("button", {
      name: "Incident 3.0 stars, 8 reports",
      exact: true,
    });
    await expect(oldBadge).toBeVisible();
    await expect
      .poll(
        async () => (await oldBadge.locator(".map-badge").boundingBox())?.width,
      )
      .toBeCloseTo(44.8, 0);
    const before = await oldBadge.boundingBox();
    const areas = [incidentAt(0, 0), incidentAt(1, 4), incidentAt(2, 5)];
    const snapshot = {
      incidents: areas,
      refuges: [],
      serverTime: new Date().toISOString(),
    };
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route("**/api/v1/snapshot?**", async (route) => {
      requests++;
      await ready;
      await route.fulfill({ json: snapshot });
    });
    await page.route("**/api/v1/events?**", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
      }),
    );
    const refresh = page.getByRole("button", {
      name: "Refresh map",
      exact: true,
    });
    const target = await refresh.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    await refresh.click();
    const loading = page.getByRole("button", {
      name: "Refreshing map",
      exact: true,
    });
    await expect(loading).toBeDisabled();
    await expect(loading).toHaveAttribute("aria-busy", "true");
    expect(requests).toBe(1);
    release();
    const updated = page.getByRole("button", {
      name: "Incident 4.0 stars, 8 reports",
      exact: true,
    });
    await expect(updated).toBeVisible();
    await expect(refresh).toBeEnabled();
    const after = await updated.boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(after!.width).toBeCloseTo(before!.width, 0);
    // The short mocked SSE response closes and may trigger normal fallback polling.
    await page.screenshot({
      path: `../artifacts/screenshots/map-refresh-${width}.png`,
    });
  });
