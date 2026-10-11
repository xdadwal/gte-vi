import { useEffect, useState, useRef } from "react";
import { useSettings, pollingDelay } from "./settings";
import { api } from "./api";
import type { Incident, Snapshot } from "./model";
export function useLive(cells: string[], overview = false) {
  const {
    settings: { values: config },
    applySettings,
  } = useSettings();
  const configRef = useRef(config);
  configRef.current = config;
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
  const rebaseTimers = useRef<(() => void) | null>(null);
  useEffect(() => {
    rebaseTimers.current?.();
  }, [
    config.pollingSeconds,
    config.staleSeconds,
    config.reconnectMinSeconds,
    config.reconnectMaxSeconds,
  ]);
  useEffect(() => {
    const gen = ++generation.current;
    setState(document.hidden ? "paused" : "connecting");
    let active = true,
      source: EventSource | undefined,
      poll: ReturnType<typeof setInterval> | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      last = 0,
      delay = configRef.current.reconnectMinSeconds * 1000,
      streamEpoch = 0,
      refugePull = 0,
      nextPull = 0,
      retryStarted = 0,
      retryDelay = 0;
    const revisions = new Map<string, number>();
    const valid = () => active && gen === generation.current;
    const apply = (s: Snapshot) => {
      if (!valid()) return;
      applySettings(s.settings);
      last = Date.now();
      loadedKey.current = key;
      revisions.clear();
      for (const [cell, revision] of Object.entries(s.revisions || {}))
        revisions.set(cell, revision);
      for (const i of s.incidents) revisions.set(i.cell, i.revision);
      setSnapshot((old) => ({ ...s, overview: s.overview || old.overview }));
    };
    // Colons and commas are valid query characters. Keep other characters
    // escaped, but avoid inflating 4096-cell subscriptions past proxy limits.
    const query = `cells=${encodeURIComponent(key).replace(/%3A/g, ":").replace(/%2C/g, ",")}`;
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
      setState("stale");
      if (!poll) {
        ++streamEpoch;
        void pull();
        nextPull = Date.now() + pollingDelay(configRef.current);
        poll = setInterval(() => {
          if (Date.now() >= nextPull) {
            void pull();
            nextPull = Date.now() + pollingDelay(configRef.current);
          }
        }, 250);
      }
      if (!cells.length) return;
      if (!retry) {
        retryStarted = Date.now();
        retryDelay = Math.max(
          configRef.current.reconnectMinSeconds * 1000,
          Math.min(delay, configRef.current.reconnectMaxSeconds * 1000),
        );
        retry = setTimeout(() => {
          retry = undefined;
          connect();
        }, retryDelay);
      }
      delay = Math.min(delay * 2, configRef.current.reconnectMaxSeconds * 1000);
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
          delay = configRef.current.reconnectMinSeconds * 1000;
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
        if (msg.type === "settings") {
          applySettings(msg.settings);
          return;
        }
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
    const rebase = () => {
      if (poll) nextPull = Date.now() + pollingDelay(configRef.current);
      const minimum = configRef.current.reconnectMinSeconds * 1000,
        maximum = configRef.current.reconnectMaxSeconds * 1000;
      delay = Math.max(minimum, Math.min(delay, maximum));
      if (retry) {
        clearTimeout(retry);
        retryDelay = Math.max(minimum, Math.min(retryDelay, maximum));
        retry = setTimeout(
          () => {
            retry = undefined;
            connect();
          },
          Math.max(0, retryStarted + retryDelay - Date.now()),
        );
      }
    };
    rebaseTimers.current = rebase;
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
        if (valid()) {
          applySettings(s.settings);
          setSnapshot((old) => ({ ...old, overview: s.overview }));
        }
      } catch {
        /* Detailed local data still has its own freshness gate. */
      }
    };
    if (overview) void refreshOverview();
    let lastOverview = Date.now();
    const overviewTimer = setInterval(() => {
      if (
        Date.now() - lastOverview >=
        configRef.current.overviewRefreshSeconds * 1000
      ) {
        lastOverview = Date.now();
        void refreshOverview();
      }
    }, 1000);
    const monitor = setInterval(() => {
      if (
        valid() &&
        !document.hidden &&
        last &&
        Date.now() - last > configRef.current.staleSeconds * 1000
      ) {
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
      if (rebaseTimers.current === rebase) rebaseTimers.current = null;
      stop();
      clearInterval(monitor);
      clearInterval(overviewTimer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, overview, applySettings]);
  return {
    snapshot,
    state,
    fresh:
      loadedKey.current === key && (state === "live" || state === "polling"),
  };
}
export function useLocation() {
  const {
    settings: { values: config },
  } = useSettings();
  const locationConfig = useRef(config);
  locationConfig.current = config;
  const [fix, setFix] = useState<import("./model").Fix | null>(null),
    [error, setError] = useState("");
  const watch = useRef<number | null>(null);
  const enabled = useRef(false);
  const start = () => {
    if (window.isSecureContext === false) {
      setError(
        "Location requires HTTPS on this device. Open the secure preview to report or find a refuge.",
      );
      return;
    }
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
            ? "Location access is blocked. Allow location for this site and for your browser, then try again."
            : "Could not obtain your location. Try again.",
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: Math.min(
          5000,
          locationConfig.current.locationMaxAgeSeconds * 1000,
        ),
        timeout: 15000,
      },
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
