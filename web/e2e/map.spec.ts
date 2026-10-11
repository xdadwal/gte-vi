import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("anonymous mobile report holds, cancels and confirms server acknowledgement", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { longitude: 77.209, latitude: 28.6139, accuracy: 15 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.locator("#rating-description")).toHaveText(
    "Select a star rating to see its meaning.",
  );
  for (const [index, description] of [
    "Checkposts with fewer than 5 personnel.",
    "Active personnel.",
    "Detention ongoing.",
    "Manhandling and higher personnel count.",
    "Full-blown violence.",
  ].entries()) {
    const n = index + 1;
    const rating = page.getByRole("button", {
      name: `${n} star${n > 1 ? "s" : ""}`,
      exact: true,
    });
    await rating.click();
    await expect(rating).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#rating-description")).toHaveText(description);
  }
  await page.getByRole("button", { name: "3 stars", exact: true }).click();
  await page.screenshot({
    path: "../artifacts/screenshots/mobile-rating-description.png",
  });
  const hold = page.getByRole("button", { name: "Hold 3s to report" });
  await expect(hold).toBeEnabled();
  await hold.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(700);
  await page.keyboard.up("Space");
  await expect(page.getByText("Sending…", { exact: true })).toHaveCount(0);
  await hold.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(3200);
  await page.keyboard.up("Space");
  await expect(page.getByText(/Reported · 3 stars/)).toBeVisible();
  await page.screenshot({ path: "../artifacts/screenshots/mobile-report.png" });
  await context.close();
});
test("operator edits a draft, publishes and closes a refuge", async ({
  page,
}) => {
  // Local-network HTTP has getRandomValues but no randomUUID.
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  const refugeName =
    "Automated test refuge " + Date.now() + " — not operational";
  await page.goto("/admin");
  await page
    .getByLabel("Local development token")
    .fill(process.env.DEV_AUTH_TOKEN || "local-development-only");
  await page.getByRole("button", { name: "Local sign-in" }).click();
  await expect(
    page.getByRole("heading", { name: "Live incidents" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refuges", exact: true }).click();
  await page.getByRole("button", { name: "Add refuge" }).click();
  await page.getByLabel("Name", { exact: true }).fill(refugeName);
  await page
    .getByLabel("Access instructions")
    .fill("TEST RECORD. Never use as a real destination.");
  await page.getByLabel("Host contact").fill("Test fixture only");
  await page
    .getByLabel("Confirmation notes")
    .fill("Automated synthetic verification");
  await page.getByLabel("Confirmation date").fill("2026-10-10");
  await page
    .getByLabel("Publication", { exact: true })
    .selectOption("published");
  await page.getByRole("button", { name: "Preview publication" }).click();
  await expect(
    page.getByText("Host contact and confirmation notes stay private."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save refuge", exact: true }).click();
  await expect(page.getByText("Refuge saved", { exact: true })).toBeVisible();
  await page
    .getByRole("button")
    .filter({ hasText: refugeName })
    .first()
    .click();
  await page.getByLabel("Temporarily closed, reopen manually").check();
  await page.getByRole("button", { name: "Preview publication" }).click();
  await page.getByRole("button", { name: "Save refuge", exact: true }).click();
  await expect(page.getByText(/Manually closed/).first()).toBeVisible();
  await page.screenshot({ path: "../artifacts/screenshots/admin-refuges.png" });
});
test("responsive map and operator views have no page overflow", async ({
  page,
}) => {
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Report", exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(1500);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `../artifacts/screenshots/map-${name}.png` });
  }
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
});
test("real worker previews a walking route and marks it affected on host closure", async ({
  browser,
}) => {
  test.skip(!process.env.E2E_ROUTING, "Requires locally imported OSM graph");
  const context = await browser.newContext({
    geolocation: { longitude: 77.2120436, latitude: 28.6139392, accuracy: 10 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.request.post("/api/v1/auth/dev", {
    data: { token: "local-development-only" },
  });
  const me = await (await page.request.get("/api/v1/admin/me")).json();
  const refuge = {
    id: crypto.randomUUID(),
    name: "Automated route refuge not operational",
    lon: 77.2082053,
    lat: 28.6089948,
    instructions: "Synthetic browser test only",
    hours: Object.fromEntries([...Array(7)].map((_, i) => [i, [[0, 1440]]])),
    exceptions: {},
    closed: false,
    revision: 0,
    publication: "published",
    hostContact: "Synthetic host",
    confirmationNote: "Synthetic test fixture",
    confirmedAt: new Date().toISOString(),
  };
  const saved = await page.request.put("/api/v1/admin/refuges", {
    data: refuge,
    headers: { "X-CSRF-Token": me.csrf },
  });
  expect(saved.ok()).toBeTruthy();
  try {
    await page.reload();
    await page
      .getByRole("button", { name: "Find refuge", exact: true })
      .click();
    await page.waitForTimeout(600);
    await page
      .getByRole("button", { name: "Find nearest eligible refuge" })
      .click();
    await expect(page.locator(".route-summary h2")).toHaveText(refuge.name);
    const all = await (await page.request.get("/api/v1/admin/refuges")).json(),
      current = all.items.find((r: { id: string }) => r.id === refuge.id);
    const closed = await page.request.put("/api/v1/admin/refuges", {
      data: { ...current, closed: true },
      headers: { "X-CSRF-Token": me.csrf },
    });
    expect(closed.ok()).toBeTruthy();
    await expect(
      page
        .locator(".route-summary .warning")
        .filter({ hasText: "affect this route" }),
    ).toContainText("affect this route");
    await expect(page.locator(".refuge-list button")).toHaveCount(0);
  } finally {
    const data = await (await page.request.get("/api/v1/admin/refuges")).json();
    const fixture = data.items.find((r: { id: string }) => r.id === refuge.id);
    if (fixture && !fixture.closed) {
      const cleanup = await page.request.put("/api/v1/admin/refuges", {
        data: { ...fixture, closed: true },
        headers: { "X-CSRF-Token": me.csrf },
      });
      expect(cleanup.ok(), "Synthetic route refuge closed after test").toBe(
        true,
      );
    }
    await context.close();
  }
});
