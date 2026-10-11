import { AlertSound } from "./alert-sound";
import { Brand } from "./Brand";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  StarIcon,
  HouseIcon,
  CrosshairIcon,
  ArrowLeftIcon,
  SpeakerHighIcon,
  GearIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
import { MapView } from "./MapView";
import { HoldButton } from "./HoldButton";
import { useLive, useLocation } from "./live";
import { useSettings, radiusChoices, clampRadius } from "./settings";
import { api } from "./api";
import { randomId } from "./id";
import {
  alertFor,
  REPORT_CELL_METERS,
  MAX_SUBSCRIPTION_CELLS,
  cellsInBounds,
  cellsAround,
  xy,
  zone,
  refugeEligible,
  isOpen,
  openThrough,
  type Incident,
  type Refuge,
  type Fix,
  type AlertMemory,
} from "./model";
import { segmentIntervals } from "./routing";
import {
  BrowserRoutingEngine,
  type RoutingEngine,
  type WalkingRoute,
} from "./routing-engine";
const STAR_DESCRIPTIONS = [
  "Checkposts with fewer than 5 personnel.",
  "Active personnel.",
  "Detention ongoing.",
  "Manhandling and higher personnel count.",
  "Full-blown violence.",
];
function initialExit(route: WalkingRoute): [number, number][] {
  if (route.insideDistance <= 0) return [];
  const result: [number, number][] = [route.coordinates[0]];
  let remaining = route.insideDistance;
  for (let i = 1; i < route.coordinates.length && remaining > 0; i++) {
    const a = xy(...route.coordinates[i - 1]),
      b = xy(...route.coordinates[i]),
      len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= remaining) {
      result.push(route.coordinates[i]);
      remaining -= len;
    } else {
      const t = remaining / len;
      result.push([
        route.coordinates[i - 1][0] +
          t * (route.coordinates[i][0] - route.coordinates[i - 1][0]),
        route.coordinates[i - 1][1] +
          t * (route.coordinates[i][1] - route.coordinates[i - 1][1]),
      ]);
      remaining = 0;
    }
  }
  return result;
}
function preference<T>(key: string, initial: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? initial;
  } catch {
    return initial;
  }
}
export function PublicMap() {
  const {
    settings: { values: config, revision },
  } = useSettings();
  const location = useLocation(),
    [bounds, setBounds] = useState<[number, number, number, number]>([
      77.15, 28.57, 77.27, 28.67,
    ]),
    [radius, setRadius] = useState(() =>
      preference("gte-radius", config.alertRadiusDefaultMeters),
    ),
    [sound, setSound] = useState(() => preference("gte-sound", false)),
    [locate, setLocate] = useState(0),
    [panel, setPanel] = useState<
      "home" | "report" | "refuges" | "incident" | "settings"
    >("home"),
    [selected, setSelected] = useState<Incident[]>([]),
    [stars, setStars] = useState(0),
    [sending, setSending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [banner, setBanner] = useState(""),
    [route, setRoute] = useState<WalkingRoute | null>(null),
    [affected, setAffected] = useState(false),
    [calculating, setCalculating] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    location.start();
  }, []);
  const alertSound = useRef<AlertSound | null>(null);
  if (!alertSound.current) alertSound.current = new AlertSound();
  useEffect(() => {
    const unlock = () => {
      if (sound) alertSound.current?.unlock();
    };
    const visibility = () => {
      if (document.hidden) alertSound.current?.stop();
    };
    if (!sound) alertSound.current?.dispose();
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sound]);
  useEffect(() => () => alertSound.current?.dispose(), []);
  const points = location.fix ? xy(location.fix.lon, location.fix.lat) : null;
  const viewCells = useMemo(() => cellsInBounds(...bounds), [bounds]);
  const cells = useMemo(() => {
    const merged = new Set([
      ...(points
        ? cellsAround(
            points,
            Math.max(config.alertRadiusMaxMeters, config.walkingMaxMeters) +
              Math.max(
                config.bufferPerStarMeters * 5,
                config.pendingBufferMeters,
              ),
          )
        : []),
      ...viewCells,
    ]);
    return [...merged].slice(0, MAX_SUBSCRIPTION_CELLS).sort();
  }, [
    viewCells,
    points?.x && Math.floor(points.x / REPORT_CELL_METERS),
    points?.y && Math.floor(points.y / REPORT_CELL_METERS),
    radius,
    config.alertRadiusMaxMeters,
    config.walkingMaxMeters,
    config.bufferPerStarMeters,
    config.pendingBufferMeters,
  ]);
  const { snapshot, state, fresh } = useLive(cells, !viewCells.length);
  const liveFresh = useRef(fresh);
  liveFresh.current = fresh;
  const incidents = snapshot.incidents;
  const eligible = useMemo(
    () => snapshot.refuges.filter((r) => refugeEligible(r, incidents, now)),
    [snapshot.refuges, incidents, Math.floor(now / 60000)],
  );
  const memory = useRef<Record<string, AlertMemory>>(
    preference("gte-alerts", {}),
  );
  const seen = useRef<Set<string>>(
    new Set(preference("gte-reported-cells", [])),
  );
  const request = useRef<{ key: string; body: Fix & { stars: number } } | null>(
      null,
    ),
    engine = useRef<RoutingEngine | null>(null),
    routeGeneration = useRef(0),
    fingerprint = useRef(""),
    routeZones = useRef<Map<string, string>>(new Map());
  fingerprint.current = JSON.stringify([
    incidents.map((i) => [i.id, i.revision]),
    snapshot.refuges.map((r) => [r.id, r.revision]),
    config.walkingMaxMeters,
    config.walkingSpeedKmh,
    config.bufferPerStarMeters,
    config.pendingBufferMeters,
  ]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(
    () => () => {
      ++routeGeneration.current;
      engine.current?.dispose();
    },
    [],
  );
  const radiusInitialized = useRef(false);
  const [radiusReady, setRadiusReady] = useState(false);
  useEffect(() => {
    if (!revision) return;
    const needsDefault =
      !radiusInitialized.current && localStorage.getItem("gte-radius") === null;
    const defaultRadius = config.alertRadiusDefaultMeters;
    setRadius((old) =>
      needsDefault ? defaultRadius : clampRadius(old, config),
    );
    radiusInitialized.current = true;
    setRadiusReady(true);
  }, [revision, config]);
  useEffect(() => {
    if (radiusReady) localStorage.setItem("gte-radius", JSON.stringify(radius));
  }, [radius, radiusReady]);
  useEffect(() => {
    localStorage.setItem("gte-sound", JSON.stringify(sound));
  }, [sound]);
  useEffect(() => {
    if (
      !location.fix ||
      !fresh ||
      document.hidden ||
      Date.now() - location.fix.timestamp > config.locationMaxAgeSeconds * 1000
    )
      return;
    const stored = preference<Record<string, AlertMemory>>("gte-alerts", {});
    Object.assign(memory.current, stored);
    let notifySound = false;
    for (const i of incidents) {
      const a = alertFor(
        i,
        xy(location.fix.lon, location.fix.lat),
        radius,
        now,
        memory.current[i.id],
        config,
      );
      memory.current[i.id] = a.memory;
      if (a.notify) {
        setBanner(
          `${i.average.toFixed(1)} stars reported nearby · ${i.count} fresh reports`,
        );
        notifySound = true;
      }
    }
    if (sound && notifySound) alertSound.current?.play();
    const alive = new Set(incidents.map((i) => i.id));
    for (const id of Object.keys(memory.current)) {
      if (!alive.has(id)) delete memory.current[id];
    }
    localStorage.setItem("gte-alerts", JSON.stringify(memory.current));
  }, [incidents, location.fix, radius, now, fresh, sound, config]);
  useEffect(() => {
    if (!route) return;
    let invalid = !fresh || route.distance > config.walkingMaxMeters;
    const current = snapshot.refuges.find((r) => r.id === route.refuge.id);
    if (
      !current ||
      !openThrough(
        current,
        now,
        now + (route.distance / (config.walkingSpeedKmh * 1000)) * 3600000,
      ) ||
      !refugeEligible(
        current,
        incidents,
        now + (route.distance / (config.walkingSpeedKmh * 1000)) * 3600000,
      )
    )
      invalid = true;
    for (const i of incidents) {
      const signature = i.id + ":" + i.buffer;
      if (routeZones.current.get(i.cell) === signature) continue;
      for (let n = 1; n < route.coordinates.length; n++) {
        const a = xy(...route.coordinates[n - 1]),
          b = xy(...route.coordinates[n]);
        if (segmentIntervals(a, b, zone(i)).some(([l, h]) => h - l > 1e-7)) {
          invalid = true;
          break;
        }
      }
    }
    if (invalid) setAffected(true);
  }, [
    incidents,
    snapshot.refuges,
    route,
    fresh,
    Math.floor(now / 60000),
    config.walkingSpeedKmh,
    config.walkingMaxMeters,
  ]);
  const routingRules = `${config.walkingMaxMeters}:${config.walkingSpeedKmh}:${config.bufferPerStarMeters}:${config.pendingBufferMeters}`;
  const previousRules = useRef(routingRules);
  useEffect(() => {
    if (previousRules.current !== routingRules) {
      ++routeGeneration.current;
      engine.current?.dispose();
      setCalculating(false);
      if (route) setAffected(true);
      previousRules.current = routingRules;
    }
  }, [routingRules, route]);
  const offSince = useRef<number | null>(null);
  useEffect(() => {
    if (
      !route ||
      !location.fix ||
      location.fix.accuracy > config.offRouteMeters
    )
      return;
    const p = xy(location.fix.lon, location.fix.lat);
    let distance = Infinity;
    for (let n = 1; n < route.coordinates.length; n++) {
      const a = xy(...route.coordinates[n - 1]),
        b = xy(...route.coordinates[n]),
        dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
      distance = Math.min(
        distance,
        Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy),
      );
    }
    if (distance > config.offRouteMeters) {
      offSince.current ??= now;
      if (now - offSince.current >= config.offRouteSeconds * 1000) {
        setAffected(true);
        setBanner("You’re off the route. Reroute when ready.");
      }
    } else offSince.current = null;
  }, [location.fix, route, now, config.offRouteMeters, config.offRouteSeconds]);
  function openReport() {
    location.start();
    setPanel("report");
    setMessage("");
    setError("");
  }
  async function submit() {
    if (!stars || sending) return;
    setError("");
    if (!request.current) {
      const fix = location.fix;
      if (
        !fix ||
        Date.now() - fix.timestamp > config.locationMaxAgeSeconds * 1000 ||
        fix.accuracy > config.locationAccuracyMeters
      ) {
        location.start();
        setError(
          `Waiting for a recent location accurate within ${config.locationAccuracyMeters} metres.`,
        );
        return;
      }
      request.current = { key: randomId(), body: { ...fix, stars } };
    }
    const currentFix = location.fix;
    if (
      currentFix &&
      Date.now() - currentFix.timestamp <=
        config.locationMaxAgeSeconds * 1000 &&
      currentFix.accuracy <= config.locationAccuracyMeters
    ) {
      const original = xy(request.current.body.lon, request.current.body.lat),
        current = xy(currentFix.lon, currentFix.lat);
      if (
        Math.floor(original.x / REPORT_CELL_METERS) ===
          Math.floor(current.x / REPORT_CELL_METERS) &&
        Math.floor(original.y / REPORT_CELL_METERS) ===
          Math.floor(current.y / REPORT_CELL_METERS)
      )
        request.current.body = {
          ...currentFix,
          stars: request.current.body.stars,
        };
    }
    setSending(true);
    try {
      const { csrf } = await api<{ csrf: string }>("session", "POST", {});
      const incident = await api<Incident>(
        "report",
        "PUT",
        request.current.body,
        csrf,
        request.current.key,
      );
      const updated = seen.current.has(incident.cell);
      seen.current.add(incident.cell);
      localStorage.setItem(
        "gte-reported-cells",
        JSON.stringify([...seen.current]),
      );
      setMessage(
        `${updated ? "Report updated" : "Reported"} · ${request.current.body.stars} stars`,
      );
      request.current = null;
      setStars(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function calculate(target?: Refuge) {
    if (!fresh) {
      setError("Refresh map updates before finding a route.");
      return;
    }
    const fix = location.fix;
    if (
      !fix ||
      Date.now() - fix.timestamp > config.locationMaxAgeSeconds * 1000 ||
      fix.accuracy > config.locationAccuracyMeters
    ) {
      location.start();
      setError("Waiting for a recent location before finding a route.");
      return;
    }
    engine.current ??= new BrowserRoutingEngine();
    const id = ++routeGeneration.current,
      stamp = fingerprint.current;
    setCalculating(true);
    setError("");
    try {
      const result = await engine.current.route({
        origin: fix,
        refuges: target ? [target] : eligible,
        zones: incidents.map(zone),
        now: Date.now(),
        settings: {
          walkingMaxMeters: config.walkingMaxMeters,
          walkingSpeedKmh: config.walkingSpeedKmh,
        },
      });
      if (id !== routeGeneration.current) return;
      if (!liveFresh.current || stamp !== fingerprint.current)
        throw new Error(
          "Map reports changed during calculation. Please reroute.",
        );
      routeZones.current = new Map(
        incidents.map((i) => [i.cell, i.id + ":" + i.buffer]),
      );
      setRoute(result);
      setAffected(false);
      setPanel("refuges");
    } catch (error) {
      if (id === routeGeneration.current) setError((error as Error).message);
    } finally {
      if (id === routeGeneration.current) setCalculating(false);
    }
  }

  const recentFix =
    location.fix &&
    now - location.fix.timestamp <= config.locationMaxAgeSeconds * 1000;
  const displayState =
    state === "live"
      ? "Live"
      : state === "polling"
        ? "Polling updates"
        : state === "paused"
          ? "Updates paused"
          : state === "stale"
            ? "Updates outdated"
            : "Connecting";
  return (
    <main className="public-app" id="main-content">
      <MapView
        incidents={incidents}
        exitCoordinates={route ? initialExit(route) : undefined}
        refuges={eligible}
        fix={location.fix}
        autoFollow
        coordinates={route?.coordinates}
        affected={affected}
        locate={locate}
        onBounds={setBounds}
        onSelect={(items) => {
          setSelected(items);
          setPanel("incident");
        }}
        onRefuge={(r) => {
          setPanel("refuges");
          setMessage(r.name);
        }}
      />
      <header className="map-header">
        <Brand />
        <span className={`live-state ${fresh ? "healthy" : ""}`}>
          <i />
          {displayState}
        </span>
        <button
          className="icon-button"
          aria-label="Map settings"
          onClick={() => setPanel("settings")}
        >
          <GearIcon size={22} />
        </button>
      </header>
      <button
        className="locate icon-button"
        aria-label="Locate me"
        onClick={() => {
          location.start();
          setLocate((n) => n + 1);
        }}
      >
        <CrosshairIcon size={24} />
      </button>
      {banner && (
        <div className="alert-banner" role="status">
          <span>{banner}</span>
          <button
            className="alert-ack"
            title="Acknowledge alert and stop sound"
            onClick={() => {
              alertSound.current?.stop();
              setBanner("");
            }}
          >
            Ack
          </button>
        </div>
      )}
      <section
        className={`map-panel ${panel === "home" ? "compact" : ""}`}
        aria-label="Map controls"
      >
        <div className="panel-grip" />
        {panel !== "home" && (
          <div className="panel-heading">
            <button
              className="icon-button"
              aria-label="Back to map controls"
              onClick={() => {
                setPanel("home");
                setError("");
                setMessage("");
              }}
            >
              <ArrowLeftIcon size={20} />
            </button>
            <h1>
              {
                {
                  report: "Report your area",
                  refuges: "Find refuge",
                  incident: "Reported area",
                  settings: "Map settings",
                }[panel]
              }
            </h1>
          </div>
        )}
        {panel === "home" && (
          <>
            <p className="eyebrow">DELHI NCT / COMMUNITY MAP</p>
            <h1 className="home-title">
              Know your
              <br />
              <em>surroundings.</em>
            </h1>
            <p className="intro">Fresh reports from people nearby.</p>
            <div className="legend">
              <span>
                <i
                  className="severity-ramp"
                  style={{
                    background: `linear-gradient(90deg, ${config.starColors.join(", ")})`,
                  }}
                />
                1–5 ★ reported areas
              </span>
              <span>
                <i className="teal" />
                Refuges
              </span>
            </div>
            <label className="radius-label">
              Alert distance
              <select
                aria-label="Alert distance"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              >
                {radiusChoices(config).map((r) => (
                  <option key={r} value={r}>
                    {r < 1000 ? `${r} m` : `${r / 1000} km`}
                  </option>
                ))}
              </select>
            </label>
            <p className="small-copy">
              {fresh
                ? incidents.length
                  ? `${incidents.length} reported areas on this map`
                  : "No current reports nearby"
                : "Waiting for current map updates."}
            </p>
          </>
        )}
        {panel === "report" && (
          <>
            <fieldset className="stars">
              <legend>Choose stars</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={n <= stars ? "selected" : ""}
                  type="button"
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  aria-pressed={stars === n}
                  aria-describedby={
                    stars === n ? "rating-description" : undefined
                  }
                  disabled={sending}
                  onClick={() => {
                    setStars(n);
                    request.current = null;
                    setMessage("");
                  }}
                >
                  <StarIcon
                    size={38}
                    weight={n <= stars ? "fill" : "regular"}
                  />
                </button>
              ))}
            </fieldset>
            <p
              id="rating-description"
              className="rating-description"
              aria-live="polite"
              aria-atomic="true"
            >
              {stars
                ? STAR_DESCRIPTIONS[stars - 1]
                : "Select a star rating to see its meaning."}
            </p>
            <p className="small-copy">
              {location.fix
                ? `Current location · accuracy ${Math.round(location.fix.accuracy)} m`
                : "Getting your current location…"}
            </p>
            <HoldButton
              disabled={
                !stars ||
                sending ||
                !recentFix ||
                (!!location.fix &&
                  location.fix.accuracy > config.locationAccuracyMeters)
              }
              duration={config.reportHoldSeconds}
              onComplete={submit}
            />
            {sending && <p role="status">Sending…</p>}
          </>
        )}
        {panel === "incident" && (
          <div className="incident-details">
            {selected.map((item) => {
              const current = incidents.find((i) => i.id === item.id);
              return current ? (
                <article key={current.id}>
                  <span className="eyebrow">
                    {current.status === "active" ? "ACTIVE REPORTS" : "PENDING"}
                  </span>
                  <h2>
                    {current.status === "active"
                      ? `${current.average.toFixed(1)} ★`
                      : "Awaiting more reports"}
                  </h2>
                  <p>
                    {current.count} fresh reports · Updated{" "}
                    {Math.max(
                      0,
                      Math.floor((now - Date.parse(current.updatedAt)) / 60000),
                    )}{" "}
                    min ago
                  </p>
                  <p className="small-copy">
                    {current.status === "pending"
                      ? `Alerts start at ${config.activationReports} reporting sessions.`
                      : `Ratings expire after ${config.reportExpiryMinutes} minutes without refresh.`}
                  </p>
                </article>
              ) : (
                <p key={item.id}>This incident has expired or been removed.</p>
              );
            })}
            <button className="primary" onClick={openReport}>
              Report at my location
            </button>
          </div>
        )}
        {panel === "refuges" && (
          <>
            {route ? (
              <div className="route-summary">
                <span className="eyebrow">
                  {affected ? "ROUTE NEEDS REVIEW" : "WALKING ROUTE"}
                </span>
                <h2>{route.refuge.name}</h2>
                <p>
                  {(route.distance / 1000).toFixed(1)} km · about{" "}
                  {Math.ceil(
                    (route.distance / (config.walkingSpeedKmh * 1000)) * 60,
                  )}{" "}
                  min
                </p>
                {route.insideDistance > 0 && (
                  <p className="warning">
                    Starts inside a reported area. Initial exit segment:{" "}
                    {Math.ceil(route.insideDistance)} m.
                  </p>
                )}
                <p>{route.refuge.instructions}</p>
                {affected && (
                  <p className="warning">
                    Reports, availability, or your position affect this route.
                  </p>
                )}
                <button
                  className="primary"
                  disabled={calculating || !fresh}
                  onClick={() => calculate()}
                >
                  {calculating ? "Calculating…" : "Reroute"}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setRoute(null);
                    setAffected(false);
                  }}
                >
                  Clear route
                </button>
              </div>
            ) : (
              <button
                className="primary"
                disabled={calculating || !fresh}
                onClick={() => calculate()}
              >
                {calculating ? "Calculating…" : "Find nearest eligible refuge"}
              </button>
            )}
            <div className="refuge-list">
              {eligible.length ? (
                eligible.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => calculate(r)}
                    disabled={calculating || !fresh}
                  >
                    <HouseIcon size={24} />
                    <span>
                      <strong>{r.name}</strong>
                      <small>Open now · preview walking route</small>
                    </span>
                    <ArrowRightIcon size={20} />
                  </button>
                ))
              ) : (
                <p className="small-copy">
                  No eligible refuges are currently available.
                </p>
              )}
            </div>
          </>
        )}
        {panel === "settings" && (
          <>
            <label className="check-label">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  if (e.target.checked) alertSound.current?.unlock();
                  else alertSound.current?.dispose();
                  setSound(e.target.checked);
                }}
              />
              <SpeakerHighIcon size={22} />
              Sound for nearby alerts
            </label>
            <p className="small-copy">
              Alerts operate while this map is open and active. Your location is
              not shown to other people.
            </p>
          </>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {(error || location.error) && (
          <p className="error" role="alert">
            {error || location.error}
          </p>
        )}
        {panel === "home" && (
          <div className="main-actions">
            <button className="primary" onClick={openReport}>
              <StarIcon weight="fill" size={22} />
              Report
            </button>
            <button
              className="secondary"
              onClick={() => {
                location.start();
                setPanel("refuges");
                setError("");
                setMessage("");
              }}
            >
              <HouseIcon size={22} />
              Find refuge
            </button>
          </div>
        )}
        <p className="panel-footer">
          Community reports. Conditions can change.
        </p>
      </section>
      <div className="map-caption">
        DELHI / INDIA
        <span>
          Anonymous reports · {config.reportExpiryMinutes}-minute freshness
        </span>
      </div>
    </main>
  );
}
