import { useEffect, useState, useRef } from "react";
import { api } from "./api";
import type { Incident, Snapshot } from "./model";
export function useLive(cells: string[], overview = false) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
      incidents: [],
      refuges: [],
      serverTime: "",
    }),
    [state, setState] = useState<
      "connecting" | "live" | "polling" | "paused" | "stale"
    >("connecting");
  const generation = useRef(0),
    loadedKey = useRef("");
  const key = cells.join(",");
  useEffect(() => {
    const gen = ++generation.current;
    setState(document.hidden ? "paused" : "connecting");
    let active = true,
      source: EventSource | undefined,
      poll: ReturnType<typeof setInterval> | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      last = 0,
      delay = 1000,
      streamEpoch = 0,
      refugePull = 0;
    const revisions = new Map<string, number>();
    const valid = () => active && gen === generation.current;
    const apply = (s: Snapshot) => {
      if (!valid()) return;
      last = Date.now();
      loadedKey.current = key;
      revisions.clear();
      for (const [cell, revision] of Object.entries(s.revisions || {}))
        revisions.set(cell, revision);
      for (const i of s.incidents) revisions.set(i.cell, i.revision);
      setSnapshot((old) => ({ ...s, overview: s.overview || old.overview }));
    };
    const query = `cells=${encodeURIComponent(key)}`;
    const pull = async () => {
      const epoch = streamEpoch;
      try {
        const result = await api<Snapshot>(
          `snapshot?${query}&overview=${overview}`,
        );
        if (!valid() || epoch !== streamEpoch) return;
        apply(result);
        setState("polling");
      } catch {
        if (valid() && epoch === streamEpoch) setState("stale");
      }
    };
    const fallback = () => {
      if (!valid()) return;
      ++streamEpoch;
      setState("stale");
      if (!poll) {
        void pull();
        poll = setInterval(pull, 9500 + Math.random() * 1000);
      }
      if (!cells.length) return;
      if (!retry)
        retry = setTimeout(() => {
          retry = undefined;
          connect();
        }, delay);
      delay = Math.min(delay * 2, 30000);
    };
    const connect = () => {
      if (!valid() || document.hidden) return;
      source?.close();
      if (!cells.length) {
        fallback();
        return;
      }
      const currentSource = (source = new EventSource(
        `/api/v1/events?${query}`,
      ));
      source.addEventListener("snapshot", (event) => {
        if (!valid() || source !== currentSource) return;
        ++streamEpoch;
        apply(JSON.parse((event as MessageEvent).data));
        if (valid()) {
          setState("live");
          delay = 1000;
          if (poll) {
            clearInterval(poll);
            poll = undefined;
          }
        }
      });
      source.addEventListener("heartbeat", () => {
        if (!valid() || source !== currentSource) return;
        last = Date.now();
      });
      source.addEventListener("update", (event) => {
        if (!valid() || source !== currentSource) return;
        last = Date.now();
        const msg = JSON.parse((event as MessageEvent).data);
        if (msg.type === "refuges") {
          setState("stale");
          const fetchID = ++refugePull,
            epoch = streamEpoch;
          void api<Pick<Snapshot, "refuges">>("refuges")
            .then((s) => {
              if (
                valid() &&
                source === currentSource &&
                epoch === streamEpoch &&
                fetchID === refugePull
              ) {
                setSnapshot((old) => ({ ...old, refuges: s.refuges }));
                setState("live");
              }
            })
            .catch(() => {
              if (valid() && source === currentSource) {
                source?.close();
                source = undefined;
                fallback();
              }
            });
          return;
        }
        const next: Incident = msg.incident;
        if ((revisions.get(msg.cell) || 0) >= next.revision) return;
        revisions.set(msg.cell, next.revision);
        setSnapshot((old) => {
          const incidents = old.incidents.filter((i) => i.cell !== msg.cell);
          if (msg.type === "upsert") incidents.push(next);
          return { ...old, incidents };
        });
      });
      source.onerror = () => {
        if (source !== currentSource) return;
        source?.close();
        source = undefined;
        fallback();
      };
    };
    const stop = () => {
      source?.close();
      source = undefined;
      ++streamEpoch;
      if (poll) clearInterval(poll);
      poll = undefined;
      if (retry) clearTimeout(retry);
      retry = undefined;
    };
    const visibility = () => {
      stop();
      if (document.hidden) setState("paused");
      else {
        last = 0;
        setState("connecting");
        connect();
      }
    };
    const refreshOverview = async () => {
      if (!overview || !valid() || document.hidden) return;
      try {
        const s = await api<Snapshot>("snapshot?overview=true");
        if (valid()) setSnapshot((old) => ({ ...old, overview: s.overview }));
      } catch {
        /* Detailed local data still has its own freshness gate. */
      }
    };
    if (overview) void refreshOverview();
    const overviewTimer = setInterval(refreshOverview, 30000);
    const monitor = setInterval(() => {
      if (valid() && !document.hidden && last && Date.now() - last > 45000) {
        setState("stale");
        source?.close();
        source = undefined;
        fallback();
      }
    }, 1000);
    document.addEventListener("visibilitychange", visibility);
    connect();
    return () => {
      active = false;
      stop();
      clearInterval(monitor);
      clearInterval(overviewTimer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, overview]);
  return {
    snapshot,
    state,
    fresh:
      loadedKey.current === key && (state === "live" || state === "polling"),
  };
}
export function useLocation() {
  const [fix, setFix] = useState<import("./model").Fix | null>(null),
    [error, setError] = useState("");
  const watch = useRef<number | null>(null);
  const enabled = useRef(false);
  const start = () => {
    if (!navigator.geolocation) {
      setError(
        "Location is unavailable in this browser. You can still browse.",
      );
      return;
    }
    enabled.current = true;
    setError("");
    if (watch.current !== null) return;
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        setFix({
          lon: p.coords.longitude,
          lat: p.coords.latitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        });
        setError("");
      },
      (e) => {
        if (watch.current !== null)
          navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
        setError(
          e.code === 1
            ? "Location permission is off. Enable it in your browser to report or find a refuge."
            : "Could not obtain your location. Try again.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  };
  useEffect(() => {
    const stop = () => {
      if (watch.current !== null) {
        navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
      }
    };
    const visibility = () => {
      if (document.hidden) stop();
      else if (enabled.current) start();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return { fix, error, start };
}
