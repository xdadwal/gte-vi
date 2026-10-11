import { test, expect } from "@playwright/test";
import { ll, xy, REPORT_CELL_METERS } from "../src/model";

test("nearby sound pulses until Ack immediately silences it", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    geolocation: { longitude: 77.209, latitude: 28.6139, accuracy: 15 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const stats = {
      starts: 0,
      ends: 0,
      stops: [] as number[],
      peaks: [] as number[],
    };
    (window as unknown as { alertAudio: typeof stats }).alertAudio = stats;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      createOscillator() {
        const node = super.createOscillator();
        const start = node.start.bind(node),
          stop = node.stop.bind(node);
        node.start = (time) => {
          stats.starts++;
          start(time);
        };
        node.stop = (time) => {
          stats.stops.push(time ?? this.currentTime);
          stop(time);
        };
        node.addEventListener("ended", () => stats.ends++);
        return node;
      }
      createGain() {
        const node = super.createGain();
        const ramp = node.gain.linearRampToValueAtTime.bind(node.gain);
        node.gain.linearRampToValueAtTime = (value, time) => {
          stats.peaks.push(value);
          return ramp(value, time);
        };
        return node;
      }
    };
  });
  const point = xy(77.209, 28.6139),
    x = Math.floor(point.x / REPORT_CELL_METERS),
    y = Math.floor(point.y / REPORT_CELL_METERS);
  const ring = [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
    [x, y],
  ].map(([a, b]) => ll(a * REPORT_CELL_METERS, b * REPORT_CELL_METERS));
  const incident = {
    id: "audible-alert-fixture",
    cell: `${x}:${y}`,
    status: "active",
    average: 3,
    count: 5,
    buffer: 300,
    revision: 1,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    geometry: { type: "Polygon", coordinates: [ring] },
    hotzone: { type: "Polygon", coordinates: [ring] },
  };
  const snapshot = {
    incidents: [incident],
    refuges: [],
    overview: [],
    serverTime: new Date().toISOString(),
  };
  await page.route("**/api/v1/snapshot?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/v1/events?**", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Map settings", exact: true }).click();
  await page.getByLabel("Sound for nearby alerts").check();
  await page.getByRole("button", { name: "Locate me", exact: true }).click();
  const ack = page.getByRole("button", { name: "Ack", exact: true });
  await expect(ack).toBeVisible();
  const stats = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            alertAudio: {
              starts: number;
              ends: number;
              stops: number[];
              peaks: number[];
            };
          }
        ).alertAudio,
    );
  await expect.poll(async () => (await stats()).starts).toBe(1);
  await page.waitForTimeout(900);
  const playing = await stats();
  expect(playing.ends).toBe(0);
  expect(Math.max(...playing.peaks)).toBe(0.28);
  await page.screenshot({
    path: "../artifacts/screenshots/alert-ack-mobile.png",
  });
  await ack.click();
  await expect(page.locator(".alert-banner")).toHaveCount(0);
  await expect.poll(async () => (await stats()).ends).toBe(1);
  const stopped = await stats();
  expect(stopped.stops).toHaveLength(2);
  expect(stopped.stops[1]).toBeLessThan(stopped.stops[0]);
  await page.waitForTimeout(1100);
  expect((await stats()).starts).toBe(1);
  await context.close();
});
