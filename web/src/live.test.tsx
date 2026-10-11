import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useLive, useLocation } from "./live";
class Events extends EventTarget {
  static current: Events;
  onerror: (() => void) | null = null;
  constructor() {
    super();
    Events.current = this;
  }
  close() {}
  send(name: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}
beforeEach(() => {
  vi.stubGlobal("EventSource", Events);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
test("failed fallback remains stale until a successful snapshot", async () => {
  const { result } = renderHook(() => useLive(["1431:6334"]));
  act(() => Events.current.onerror?.());
  await waitFor(() => expect(result.current.state).toBe("stale"));
  expect(result.current.fresh).toBe(false);
});
test("removed-cell revision prevents an older upsert resurrecting it", () => {
  const { result } = renderHook(() => useLive(["1431:6334"]));
  act(() => {
    Events.current.send("snapshot", {
      incidents: [],
      refuges: [],
      serverTime: "",
    });
    Events.current.send("update", {
      type: "remove",
      cell: "1431:6334",
      incident: { cell: "1431:6334", revision: 10 },
    });
    Events.current.send("update", {
      type: "upsert",
      cell: "1431:6334",
      incident: { cell: "1431:6334", revision: 9 },
    });
  });
  expect(result.current.snapshot.incidents).toEqual([]);
});
test("closure events refresh authoritative refuge state rather than polling cache", async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ refuges: [{ id: "r", closed: true, revision: 2 }] }),
  } as Response);
  const { result } = renderHook(() => useLive(["1431:6334"]));
  act(() => {
    Events.current.send("snapshot", {
      incidents: [],
      refuges: [{ id: "r", closed: false, revision: 1 }],
      serverTime: "",
    });
    Events.current.send("update", { type: "refuges" });
  });
  await waitFor(() =>
    expect(result.current.snapshot.refuges[0].closed).toBe(true),
  );
  expect(fetch).toHaveBeenCalledWith("/api/v1/refuges", expect.anything());
  expect(result.current.fresh).toBe(true);
});
test("a delayed refuge response cannot revive a closed stale stream", async () => {
  vi.useFakeTimers();
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation((url) =>
    String(url).endsWith("/refuges")
      ? new Promise((r) => (resolve = r))
      : Promise.reject(new Error("offline")),
  );
  const { result, unmount } = renderHook(() => useLive(["1431:6334"]));
  act(() => {
    Events.current.send("snapshot", {
      incidents: [],
      refuges: [],
      serverTime: "",
    });
    Events.current.send("update", { type: "refuges" });
    vi.advanceTimersByTime(46000);
  });
  await act(async () => {
    resolve({ ok: true, json: async () => ({ refuges: [] }) } as Response);
    await Promise.resolve();
  });
  expect(result.current.fresh).toBe(false);
  unmount();
  vi.useRealTimers();
});

test("insecure location requests explain HTTPS without requesting permission", () => {
  vi.stubGlobal("isSecureContext", false);
  const watchPosition = vi.fn();
  vi.stubGlobal("navigator", {
    geolocation: { watchPosition, clearWatch: vi.fn() },
  });
  const { result } = renderHook(() => useLocation());
  act(() => result.current.start());
  expect(result.current.error).toContain("Location requires HTTPS");
  expect(result.current.error).not.toContain("permission is off");
  expect(watchPosition).not.toHaveBeenCalled();
});

test("secure location requests distinguish permission denial from HTTP blocking", () => {
  vi.stubGlobal("isSecureContext", true);
  const watchPosition = vi.fn(
    (_success: unknown, _error: (e: { code: number }) => void) => 1,
  );
  vi.stubGlobal("navigator", {
    geolocation: { watchPosition, clearWatch: vi.fn() },
  });
  const { result } = renderHook(() => useLocation());
  act(() => result.current.start());
  expect(watchPosition).toHaveBeenCalledOnce();
  act(() => watchPosition.mock.calls[0][1]({ code: 1 }));
  expect(result.current.error).toContain("Location access is blocked");
  expect(result.current.error).not.toContain("requires HTTPS");
});
test("settings events update behavior without reconnecting the live stream", async () => {
  const { SettingsProvider, useSettings, DEFAULT_SETTINGS } =
    await import("./settings");
  const { result } = renderHook(
    () => ({ live: useLive(["1431:6334"]), settings: useSettings().settings }),
    { wrapper: SettingsProvider },
  );
  const connection = Events.current;
  act(() => {
    connection.send("snapshot", {
      incidents: [],
      refuges: [],
      serverTime: "",
      settings: { revision: 1, values: DEFAULT_SETTINGS },
    });
    connection.send("update", {
      type: "settings",
      settings: {
        revision: 2,
        values: {
          ...DEFAULT_SETTINGS,
          reportHoldSeconds: 2,
          pollingSeconds: 12,
        },
      },
    });
  });
  expect(result.current.settings.values.reportHoldSeconds).toBe(2);
  expect(result.current.settings.values.pollingSeconds).toBe(12);
  expect(result.current.live.fresh).toBe(true);
  expect(Events.current).toBe(connection);
  act(() =>
    connection.send("update", {
      type: "settings",
      settings: { revision: 1, values: DEFAULT_SETTINGS },
    }),
  );
  expect(result.current.settings.revision).toBe(2);
});
test("fallback polling rebases a long interval after settings shorten it", async () => {
  vi.useFakeTimers();
  const { SettingsProvider, useSettings, DEFAULT_SETTINGS } =
    await import("./settings");
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes("/snapshot?"))
      return {
        ok: true,
        json: async () => ({ incidents: [], refuges: [], serverTime: "" }),
      } as Response;
    throw new Error("offline");
  });
  const { result } = renderHook(
    () => ({ live: useLive([]), apply: useSettings().applySettings }),
    { wrapper: SettingsProvider },
  );
  act(() =>
    result.current.apply({
      revision: 1,
      values: { ...DEFAULT_SETTINGS, pollingSeconds: 120, staleSeconds: 121 },
    }),
  );
  await act(async () => {});
  const snapshotCalls = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes("/snapshot?")).length;
  const before = snapshotCalls();
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(snapshotCalls()).toBe(before);
  act(() =>
    result.current.apply({
      revision: 2,
      values: { ...DEFAULT_SETTINGS, pollingSeconds: 1 },
    }),
  );
  await act(async () => {
    vi.advanceTimersByTime(1250);
  });
  expect(snapshotCalls()).toBeGreaterThan(before);
  expect(result.current.live.fresh).toBe(true);
});
test("pending reconnect respects newly lowered and raised reconnect bounds", async () => {
  vi.useFakeTimers();
  const { SettingsProvider, useSettings, DEFAULT_SETTINGS } =
    await import("./settings");
  const { result } = renderHook(
    () => ({
      live: useLive(["1431:6334"]),
      apply: useSettings().applySettings,
    }),
    { wrapper: SettingsProvider },
  );
  act(() =>
    result.current.apply({
      revision: 1,
      values: {
        ...DEFAULT_SETTINGS,
        reconnectMinSeconds: 30,
        reconnectMaxSeconds: 60,
      },
    }),
  );
  const first = Events.current;
  act(() => first.onerror?.());
  act(() =>
    result.current.apply({
      revision: 2,
      values: {
        ...DEFAULT_SETTINGS,
        reconnectMinSeconds: 1,
        reconnectMaxSeconds: 2,
      },
    }),
  );
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(Events.current).not.toBe(first);
  const second = Events.current;
  act(() => second.onerror?.());
  act(() =>
    result.current.apply({
      revision: 3,
      values: {
        ...DEFAULT_SETTINGS,
        reconnectMinSeconds: 5,
        reconnectMaxSeconds: 10,
      },
    }),
  );
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(Events.current).toBe(second);
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(Events.current).not.toBe(second);
});
test("a slow polling snapshot can recover after stale stream silence", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(
          () =>
            resolve({
              ok: true,
              json: async () => ({
                incidents: [],
                refuges: [],
                serverTime: "recovered",
              }),
            } as Response),
          1500,
        );
      }),
  );
  const { result } = renderHook(() => useLive(["1431:6334"]));
  act(() =>
    Events.current.send("snapshot", {
      incidents: [],
      refuges: [],
      serverTime: "initial",
    }),
  );
  await act(async () => {
    vi.advanceTimersByTime(46000);
  });
  expect(result.current.fresh).toBe(false);
  await act(async () => {
    vi.advanceTimersByTime(1500);
  });
  expect(result.current.snapshot.serverTime).toBe("recovered");
  expect(result.current.fresh).toBe(true);
});
