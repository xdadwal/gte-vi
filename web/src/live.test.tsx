import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useLive } from "./live";
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
afterEach(() => vi.unstubAllGlobals());
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
