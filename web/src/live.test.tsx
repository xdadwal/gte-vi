import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useLive, useLocation } from "./live";
class Events extends EventTarget {
  static current: Events;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
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
test("maximum cell subscription leaves room for load-balancer headers in SSE and polling", async () => {
  const cells = Array.from({ length: 4096 }, (_, i) => `8000:${35000 + i}`);
  renderHook(() => useLive(cells));
  const stream = new URL(Events.current.url, "https://example.test");
  expect(stream.searchParams.get("cells")?.split(",")).toEqual(cells);
  expect(stream.pathname.length + stream.search.length).toBeLessThan(48 * 1024);
  act(() => Events.current.onerror?.());
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const poll = new URL(
    String(vi.mocked(fetch).mock.calls[0][0]),
    stream.origin,
  );
  expect(poll.searchParams.get("cells")?.split(",")).toEqual(cells);
  expect(poll.pathname.length + poll.search.length).toBeLessThan(48 * 1024);
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
  const { SettingsProvider, useSettings, DEFAULT_SETTINGS } = await import(
    "./settings"
  );
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
  const { SettingsProvider, useSettings, DEFAULT_SETTINGS } = await import(
    "./settings"
  );
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
  const { SettingsProvider, useSettings, DEFAULT_SETTINGS } = await import(
    "./settings"
  );
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

test("location watch survives temporary errors and recovers on the next fix", () => {
  vi.stubGlobal("isSecureContext", true);
  const watchPosition = vi.fn(
    (
      _success: (p: GeolocationPosition) => void,
      _error: (e: { code: number }) => void,
    ) => 1,
  );
  const clearWatch = vi.fn();
  vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
  const { result, unmount } = renderHook(() => useLocation());
  act(() => result.current.start());
  for (const code of [2, 3]) {
    act(() => watchPosition.mock.calls[0][1]({ code }));
    expect(result.current.error).toContain("Could not obtain");
    expect(clearWatch).not.toHaveBeenCalled();
  }
  act(() =>
    watchPosition.mock.calls[0][0]({
      coords: { longitude: 77.209, latitude: 28.6139, accuracy: 10 },
      timestamp: Date.now(),
    } as GeolocationPosition),
  );
  expect(result.current.fix?.lon).toBe(77.209);
  expect(result.current.error).toBe("");
  expect(watchPosition).toHaveBeenCalledOnce();
  unmount();
  expect(clearWatch).toHaveBeenCalledWith(1);
});

test("manual refresh fetches the current area once and reconnects live updates", async () => {
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise((r) => (resolve = r)));
  const { result } = renderHook(() => useLive(["1431:6334"]));
  const previous = Events.current;
  const close = vi.spyOn(previous, "close");
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = result.current.refresh();
    void result.current.refresh();
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
    "cells=1431:6334",
  );
  expect(close).toHaveBeenCalledOnce();
  expect(result.current.refreshing).toBe(true);
  await act(async () => {
    resolve({
      ok: true,
      json: async () => ({
        incidents: [],
        refuges: [{ id: "fresh" }],
        serverTime: "now",
      }),
    } as Response);
    await refreshing;
  });
  expect(result.current.snapshot.refuges[0].id).toBe("fresh");
  expect(result.current.refreshing).toBe(false);
  expect(result.current.fresh).toBe(true);
  expect(Events.current).not.toBe(previous);
});

test("failed manual refresh retains map data and allows retry", async () => {
  const { result } = renderHook(() => useLive(["1431:6334"]));
  act(() =>
    Events.current.send("snapshot", {
      incidents: [],
      refuges: [{ id: "existing" }],
      serverTime: "now",
    }),
  );
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.snapshot.refuges[0].id).toBe("existing");
  expect(result.current.refreshError).toContain("Could not refresh");
  expect(result.current.refreshing).toBe(false);
});

test("manual refresh times out and releases the retry control", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const { result } = renderHook(() => useLive(["1431:6334"]));
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = result.current.refresh();
  });
  await act(async () => {
    vi.advanceTimersByTime(15000);
    await refreshing;
  });
  expect(result.current.refreshing).toBe(false);
  expect(result.current.refreshError).toContain("Could not refresh");
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
});

test("a delayed refresh cannot replace data for a new map area", async () => {
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { result, rerender } = renderHook(({ cell }) => useLive([cell]), {
    initialProps: { cell: "1431:6334" },
  });
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = result.current.refresh();
  });
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  rerender({ cell: "1432:6334" });
  act(() =>
    Events.current.send("snapshot", {
      incidents: [],
      refuges: [{ id: "new-area" }],
      serverTime: "now",
    }),
  );
  await act(async () => {
    resolve({
      ok: true,
      json: async () => ({
        incidents: [],
        refuges: [{ id: "old-area" }],
        serverTime: "old",
      }),
    } as Response);
    await refreshing;
  });
  expect(signal?.aborted).toBe(true);
  expect(result.current.snapshot.refuges[0].id).toBe("new-area");
  expect(result.current.refreshing).toBe(false);
});

test("stale monitor does not start a second pull during manual refresh", async () => {
  vi.useFakeTimers();
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { result } = renderHook(() => useLive(["1431:6334"]));
  act(() =>
    Events.current.send("snapshot", {
      incidents: [],
      refuges: [],
      serverTime: "now",
    }),
  );
  vi.setSystemTime(Date.now() + 46000);
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = result.current.refresh();
  });
  act(() => vi.advanceTimersByTime(1000));
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => {
    resolve({
      ok: true,
      json: async () => ({
        incidents: [],
        refuges: [{ id: "fresh" }],
        serverTime: "now",
      }),
    } as Response);
    await refreshing;
  });
  expect(result.current.snapshot.refuges[0].id).toBe("fresh");
});
