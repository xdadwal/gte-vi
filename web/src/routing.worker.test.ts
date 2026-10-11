import { afterEach, expect, it, vi } from "vitest";

const request = {
  id: 1,
  origin: { lon: 77.209, lat: 28.6139 },
  refuges: [],
  zones: [],
  now: Date.now(),
  settings: { walkingMaxMeters: 100, walkingSpeedKmh: 4 },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("loads the manifest's 500 m walking tile while reports use 250 m cells", async () => {
  const postMessage = vi.fn();
  const worker = { onmessage: undefined as unknown, postMessage };
  vi.stubGlobal("self", worker);
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("manifest.json")
        ? {
            version: "test",
            cellSize: 500,
            tiles: {
              "1431:6334": "walking-500.json",
              "2863:12668": "wrong-report-grid.json",
            },
          }
        : { nodes: [], edges: [] },
  }));
  vi.stubGlobal("fetch", fetcher);
  await import("./routing.worker");
  await (
    worker.onmessage as (event: { data: typeof request }) => Promise<void>
  )({ data: request });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/routing/manifest.json",
    "/api/v1/routing/walking-500.json",
  ]);
  expect(postMessage).toHaveBeenCalledWith({
    id: 1,
    error: "No eligible walking route found within 0.1 km.",
  });
});
it("rejects a manifest without tile dimensions instead of guessing the report grid", async () => {
  const postMessage = vi.fn();
  const worker = { onmessage: undefined as unknown, postMessage };
  vi.stubGlobal("self", worker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "test", tiles: {} }),
    })),
  );
  await import("./routing.worker");
  await (
    worker.onmessage as (event: { data: typeof request }) => Promise<void>
  )({ data: request });
  expect(postMessage).toHaveBeenCalledWith({
    id: 1,
    error: "Walking-network tile dimensions are unavailable.",
  });
});
