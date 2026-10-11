import { expect, test, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import {
  DEFAULT_SETTINGS,
  newerSettings,
  clampRadius,
  radiusChoices,
  pollingDelay,
  SettingsProvider,
} from "./settings";
import { AdminSettings } from "./AdminSettings";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("settings revisions never roll back and aligned personal radius survives", () => {
  const current = { revision: 8, values: DEFAULT_SETTINGS };
  expect(newerSettings(current, { ...current, revision: 7 })).toBe(current);
  expect(newerSettings(current, { ...current, revision: 8 })).toBe(current);
  const config = {
    ...DEFAULT_SETTINGS,
    alertRadiusMinMeters: 1000,
    alertRadiusMaxMeters: 2500,
    alertRadiusStepMeters: 500,
  };
  expect(radiusChoices(config)).toEqual([1000, 1500, 2000, 2500]);
  expect(clampRadius(2000, config)).toBe(2000);
  expect(clampRadius(500, config)).toBe(1000);
  expect(clampRadius(3000, config)).toBe(2500);
});
test("dirty settings drafts survive a newer refresh and require explicit discard", async () => {
  let revision = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        revision,
        values: {
          ...DEFAULT_SETTINGS,
          reportHoldSeconds: revision === 1 ? 3 : 4,
        },
      }),
    })),
  );
  const onDirty = vi.fn();
  render(
    <SettingsProvider>
      <AdminSettings owner csrf="token" onDirty={onDirty} />
    </SettingsProvider>,
  );
  const input = await screen.findByLabelText(/Report hold duration/);
  fireEvent.change(input, { target: { value: "2" } });
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
  revision = 2;
  fireEvent(document, new Event("visibilitychange"));
  await screen.findByText(/A newer revision is available/);
  expect((input as HTMLInputElement).value).toBe("2");
  expect(
    (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect((input as HTMLInputElement).value).toBe("4");
});
test("operators can read settings but cannot edit or save", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ revision: 1, values: DEFAULT_SETTINGS }),
    })),
  );
  render(
    <SettingsProvider>
      <AdminSettings owner={false} csrf="token" onDirty={() => {}} />
    </SettingsProvider>,
  );
  expect(
    ((await screen.findByLabelText(/Report hold duration/)) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
});

test("poll jitter stays within the configured freshness slack", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.999);
  expect(
    pollingDelay({
      ...DEFAULT_SETTINGS,
      pollingSeconds: 120,
      staleSeconds: 121,
    }),
  ).toBe(120500);
  random.mockRestore();
});
