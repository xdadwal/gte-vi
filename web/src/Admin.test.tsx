import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Admin } from "./Admin";
import { SettingsProvider, DEFAULT_SETTINGS } from "./settings";
vi.mock("./MapView", () => ({ MapView: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("admin signs in with username and password and preserves useful failure feedback", async () => {
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    let data: unknown = {};
    let ok = true;
    if (url.endsWith("/settings"))
      data = { revision: 1, values: DEFAULT_SETTINGS };
    else if (url.endsWith("/health")) data = { devLogin: false };
    else if (url.endsWith("/admin/me")) {
      ok = false;
      data = { error: "admin sign-in required" };
    } else if (url.endsWith("/auth/login")) {
      ok = false;
      data = { error: "invalid username or password" };
    }
    return { ok, json: async () => data };
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <SettingsProvider>
      <Admin />
    </SettingsProvider>,
  );
  const username = await screen.findByLabelText("Username (email)");
  const password = screen.getByLabelText("Password");
  expect(username.getAttribute("autocomplete")).toBe("username");
  expect(password.getAttribute("autocomplete")).toBe("current-password");
  fireEvent.change(username, { target: { value: "owner@example.test" } });
  fireEvent.change(password, {
    target: { value: "A sufficiently long password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe(
    "invalid username or password",
  );
  const login = fetcher.mock.calls.find(([url]) => url.endsWith("/auth/login"));
  expect(login?.[1]?.method).toBe("POST");
  expect(JSON.parse(login?.[1]?.body as string)).toEqual({
    username: "owner@example.test",
    password: "A sufficiently long password",
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("Local development token")).toBeNull();
});
