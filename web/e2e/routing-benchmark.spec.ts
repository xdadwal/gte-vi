import { test, expect } from "@playwright/test";
test("measures cold and warm browser routes on the real Delhi graph", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const worker = new Worker("/src/routing.worker.ts", { type: "module" });
    const request = {
      origin: { lon: 77.2120436, lat: 28.6139392 },
      zones: [],
      now: Date.now(),
      refuges: [
        {
          id: "synthetic-benchmark",
          name: "Synthetic benchmark endpoint",
          lon: 77.2082053,
          lat: 28.6089948,
          instructions: "Not an operational refuge",
          closed: false,
          revision: 1,
          hours: Object.fromEntries(
            [...Array(7)].map((_, i) => [i, [[0, 1440]]]),
          ),
          exceptions: {},
        },
      ],
    };
    const times: number[] = [];
    let distance = 0;
    try {
      for (let id = 1; id <= 11; id++) {
        const start = performance.now();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("worker timeout")),
            30000,
          );
          worker.onmessage = (e) => {
            clearTimeout(timer);
            if (e.data.error) reject(new Error(e.data.error));
            else {
              distance = e.data.route.distance;
              times.push(performance.now() - start);
              resolve();
            }
          };
          worker.onerror = (e) => {
            clearTimeout(timer);
            reject(new Error(e.message));
          };
          worker.postMessage({ ...request, id });
        });
      }
    } finally {
      worker.terminate();
    }
    const warm = times.slice(1).sort((a, b) => a - b);
    return {
      coldMs: times[0],
      warmP95Ms: warm[Math.floor((warm.length - 1) * 0.95)],
      samples: warm.length,
      distance,
    };
  });
  console.log(JSON.stringify(result));
  expect(result.distance).toBeLessThan(3000);
  expect(result.distance).toBeGreaterThan(0);
});
