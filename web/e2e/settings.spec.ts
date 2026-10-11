import { test, expect } from "@playwright/test";

test("owner settings update open SSE and polling maps and preserve personal preferences", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    baseURL,
    geolocation: { longitude: 77.209, latitude: 28.6139, accuracy: 15 },
    permissions: ["geolocation"],
  });
  const operator = await context.newPage();
  let original:
    { revision: number; values: Record<string, unknown> } | undefined;

  const extraContexts: import("@playwright/test").BrowserContext[] = [];
  try {
    await operator.goto("/admin");
    await operator
      .getByLabel("Local development token")
      .fill(process.env.DEV_AUTH_TOKEN || "local-development-only");
    await operator
      .getByRole("button", { name: "Local sign-in", exact: true })
      .click();
    await expect(
      operator.getByRole("heading", { name: "Live incidents" }),
    ).toBeVisible();
    const me = await (await operator.request.get("/api/v1/admin/me")).json();
    const response = await operator.request.get("/api/v1/admin/settings");
    expect(response.ok()).toBe(true);
    original = await response.json();
    await operator
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await operator.setViewportSize({ width: 390, height: 844 });
    expect(
      await operator.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await operator.setViewportSize({ width: 1440, height: 1000 });
    await expect(
      operator.getByLabel("Report hold duration (seconds)"),
    ).toHaveValue(String(original!.values.reportHoldSeconds));
    const live = await context.newPage();
    await live.addInitScript(() => localStorage.setItem("gte-radius", "2000"));
    let eventConnections = 0;
    live.on("request", (r) => {
      if (r.url().includes("/api/v1/events?")) eventConnections++;
    });
    await live.goto("/");
    await live.getByRole("button", { name: "Report", exact: true }).click();
    await expect(
      live.getByRole("button", {
        name: `Hold ${original!.values.reportHoldSeconds}s to report`,
      }),
    ).toBeVisible();
    await expect.poll(() => eventConnections).toBeGreaterThan(0);
    await live.route("**/api/v1/settings", (route) => route.abort());
    const pollingContext = await browser.newContext({
      baseURL,
      geolocation: { longitude: 77.209, latitude: 28.6139, accuracy: 15 },
      permissions: ["geolocation"],
    });
    extraContexts.push(pollingContext);
    const polling = await pollingContext.newPage();
    await polling.route("**/api/v1/events?**", (route) => route.abort());
    await polling.goto("/");
    await polling.getByRole("button", { name: "Report", exact: true }).click();
    await expect(
      polling.getByRole("button", {
        name: `Hold ${original!.values.reportHoldSeconds}s to report`,
      }),
    ).toBeVisible();
    await operator.getByLabel("Report hold duration (seconds)").fill("2");
    await operator.getByLabel("Default alert radius (m)").fill("1500");
    await operator
      .getByLabel("Change reason")
      .fill("Automated settings propagation check; restore immediately.");
    await operator
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(operator.getByText(/Settings saved/)).toBeVisible();
    await expect(
      live.getByRole("button", { name: "Hold 2s to report" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      polling.getByRole("button", { name: "Hold 2s to report" }),
    ).toBeVisible({ timeout: 20000 });
    await live.getByRole("button", { name: "Back to map controls" }).click();
    await expect(live.locator("select")).toHaveValue("2000");
    const newcomerContext = await browser.newContext({ baseURL });
    extraContexts.push(newcomerContext);
    const newcomer = await newcomerContext.newPage();
    await newcomer.goto("/");
    await expect(newcomer.locator("select")).toHaveValue("1500");
    await newcomer
      .getByRole("button", { name: "Map settings", exact: true })
      .click();
    await expect(newcomer.locator('a[href="/admin"]')).toHaveCount(0);
    const staleSave = await operator.request.put("/api/v1/admin/settings", {
      headers: { "X-CSRF-Token": me.csrf },
      data: {
        revision: original!.revision,
        values: original!.values,
        reason: "Stale revision must be rejected",
      },
    });
    expect(staleSave.status()).toBe(409);
  } finally {
    if (original) {
      const me = await (await operator.request.get("/api/v1/admin/me")).json();
      const latest = await (
        await operator.request.get("/api/v1/admin/settings")
      ).json();
      const restore = await operator.request.put("/api/v1/admin/settings", {
        headers: { "X-CSRF-Token": me.csrf },
        data: {
          revision: latest.revision,
          values: original.values,
          reason: "Restore settings after automated browser check",
        },
      });
      expect(restore.ok(), "Original settings restored").toBe(true);
    }
    for (const extra of extraContexts) await extra.close();
    await context.close();
  }
});
