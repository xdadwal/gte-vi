import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type * as GeoJSON from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import type { Incident, Refuge, Fix, Overview } from "./model";
import { ll } from "./model";
import { useSettings } from "./settings";
import { hotspotFeatures, severityColor, severityExpression } from "./hotspots";
type Props = {
  incidents: Incident[];
  overview?: Overview[];
  exitCoordinates?: [number, number][];
  refuges: Refuge[];
  fix?: Fix | null;
  coordinates?: [number, number][];
  affected?: boolean;
  locate?: number;
  selected?: Incident | null;
  onSelect?: (incidents: Incident[]) => void;
  onRefuge?: (r: Refuge) => void;
  onBounds?: (b: [number, number, number, number]) => void;
  entrance?: [number, number] | null;
  onEntrance?: (p: [number, number]) => void;
};
export function MapView(props: Props) {
  const {
    settings: { values: config, revision },
  } = useSettings();
  const settingsRef = useRef(config);
  settingsRef.current = config;
  const root = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    ready = useRef(false),
    latest = useRef(props),
    following = useRef(false),
    interacted = useRef(false),
    initialViewApplied = useRef(revision > 0),
    markers = useRef<maplibregl.Marker[]>([]);
  latest.current = props;
  function update() {
    const m = map.current;
    if (!m || !ready.current) return;
    const p = latest.current;
    const config = settingsRef.current;
    const color = severityExpression(config.starColors);
    for (const layer of ["incident-hotspots", "incident-fill"])
      m.setPaintProperty(layer, "fill-color", color);
    for (const layer of ["active-outline", "pending-outline"])
      m.setPaintProperty(layer, "line-color", color);
    m.setPaintProperty("incident-hotspots", "fill-opacity", [
      "case",
      ["==", ["get", "status"], "pending"],
      config.hotspotPendingOpacity,
      config.hotspotActiveOpacity,
    ]);
    const collection = {
      type: "FeatureCollection",
      features: p.incidents.map((i) => ({
        type: "Feature",
        geometry: i.hotzone,
        properties: { id: i.id, status: i.status, average: i.average },
      })),
    };
    (m.getSource("incidents") as GeoJSONSource).setData(
      collection as GeoJSON.FeatureCollection,
    );
    (m.getSource("hotspots") as GeoJSONSource).setData(
      hotspotFeatures(p.incidents),
    );
    (m.getSource("route") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p.coordinates
        ? [
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: p.coordinates },
              properties: {},
            },
          ]
        : [],
    });
    (m.getSource("exit") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p.exitCoordinates?.length
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: p.exitCoordinates },
            },
          ]
        : [],
    });
    m.setPaintProperty(
      "route-line",
      "line-color",
      p.affected ? "#a94820" : "#2459bd",
    );
    (m.getSource("position") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p.fix
        ? [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.fix.lon, p.fix.lat] },
              properties: {},
            },
          ]
        : [],
    });
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    for (const cluster of p.overview || []) {
      const button = document.createElement("button");
      button.className = "map-label overview-label";
      button.textContent = String(cluster.count);
      button.setAttribute(
        "aria-label",
        `${cluster.count} reported areas. Zoom to inspect`,
      );
      button.onclick = () =>
        m.easeTo({ center: [cluster.lon, cluster.lat], zoom: 14 });
      markers.current.push(
        new maplibregl.Marker({ element: button })
          .setLngLat([cluster.lon, cluster.lat])
          .addTo(m),
      );
    }
    for (const i of p.incidents) {
      const [x, y] = i.cell.split(":").map(Number),
        button = document.createElement("button");
      button.className =
        "map-label " + (i.status === "pending" ? "pending" : "");
      button.style.setProperty(
        "--severity-color",
        i.status === "pending"
          ? "#8b8170"
          : config.starColors[
              Math.max(0, Math.min(4, Math.round(i.average) - 1))
            ],
      );
      button.textContent =
        i.status === "active" ? `${i.average.toFixed(1)} ★` : "Pending";
      button.setAttribute(
        "aria-label",
        i.status === "active"
          ? `Incident ${i.average.toFixed(1)} stars, ${i.count} reports`
          : `Pending incident, ${i.count} reports`,
      );
      button.onclick = () => latest.current.onSelect?.([i]);
      markers.current.push(
        new maplibregl.Marker({ element: button })
          .setLngLat(ll(x * 500 + 250, y * 500 + 250))
          .addTo(m),
      );
    }
    for (const r of p.refuges) {
      const button = document.createElement("button");
      button.className = "refuge-marker";
      button.textContent = "⌂";
      button.title = r.name;
      button.setAttribute("aria-label", r.name);
      button.onclick = () => latest.current.onRefuge?.(r);
      markers.current.push(
        new maplibregl.Marker({ element: button })
          .setLngLat([r.lon, r.lat])
          .addTo(m),
      );
    }
    if (p.entrance) {
      const button = document.createElement("div");
      button.className = "entrance-pin";
      button.textContent = "Entrance";
      markers.current.push(
        new maplibregl.Marker({ element: button })
          .setLngLat(p.entrance)
          .addTo(m),
      );
    }
  }
  useEffect(() => {
    const m = new maplibregl.Map({
      container: root.current!,
      style:
        import.meta.env.VITE_MAP_STYLE ||
        "https://tiles.openfreemap.org/styles/positron",
      center: [config.mapLon, config.mapLat],
      zoom: config.mapZoom,
      attributionControl: false,
    });
    map.current = m;
    m.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left",
    );
    m.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    m.on("load", () => {
      ready.current = true;
      for (const id of ["incidents", "hotspots", "route", "exit", "position"])
        m.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      m.addLayer({
        id: "incident-hotspots",
        type: "fill",
        source: "hotspots",
        paint: {
          "fill-color": severityColor,
          "fill-opacity": [
            "case",
            ["==", ["get", "status"], "pending"],
            0.023,
            0.045,
          ],
          "fill-antialias": false,
        },
      });
      m.addLayer({
        id: "incident-fill",
        type: "fill",
        source: "incidents",
        paint: {
          "fill-color": severityColor,
          "fill-opacity": 0.025,
        },
      });
      m.addLayer({
        id: "active-outline",
        type: "line",
        source: "incidents",
        filter: ["==", ["get", "status"], "active"],
        paint: {
          "line-color": severityColor,
          "line-width": 1,
          "line-opacity": 0.65,
        },
      });
      m.addLayer({
        id: "pending-outline",
        type: "line",
        source: "incidents",
        filter: ["==", ["get", "status"], "pending"],
        paint: {
          "line-color": severityColor,
          "line-width": 1,
          "line-opacity": 0.65,
          "line-dasharray": [3, 2],
        },
      });
      m.addLayer({
        id: "route-outline",
        type: "line",
        source: "route",
        paint: { "line-color": "#f5f3eb", "line-width": 9 },
      });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#2459bd", "line-width": 5 },
      });
      m.addLayer({
        id: "initial-exit",
        type: "line",
        source: "exit",
        paint: {
          "line-color": "#a94820",
          "line-width": 6,
          "line-dasharray": [2, 1],
        },
      });
      m.addLayer({
        id: "position-dot",
        type: "circle",
        source: "position",
        paint: {
          "circle-radius": 8,
          "circle-color": "#2459bd",
          "circle-stroke-color": "#f5f3eb",
          "circle-stroke-width": 3,
        },
      });
      update();
      bounds();
    });
    const bounds = () => {
      const b = m.getBounds();
      latest.current.onBounds?.([
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ]);
    };
    m.on("moveend", bounds);
    m.on("movestart", (event) => {
      if (event.originalEvent) interacted.current = true;
    });
    m.on("dragstart", () => {
      following.current = false;
    });
    m.on("click", "incident-fill", (e) => {
      const ids = new Set((e.features || []).map((f) => f.properties?.id));
      latest.current.onSelect?.(
        latest.current.incidents.filter((i) => ids.has(i.id)),
      );
    });
    m.on("click", (e) => {
      if (latest.current.onEntrance)
        latest.current.onEntrance([e.lngLat.lng, e.lngLat.lat]);
    });
    return () => {
      markers.current.forEach((m) => m.remove());
      ready.current = false;
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(update, [
    config,
    props.incidents,
    props.overview,
    props.exitCoordinates,
    props.refuges,
    props.fix,
    props.coordinates,
    props.affected,
    props.entrance,
  ]);
  useEffect(() => {
    if (revision && !initialViewApplied.current) {
      initialViewApplied.current = true;
      if (!interacted.current && !following.current)
        map.current?.jumpTo({
          center: [config.mapLon, config.mapLat],
          zoom: config.mapZoom,
        });
    }
  }, [revision, config.mapLon, config.mapLat, config.mapZoom]);
  useEffect(() => {
    if (props.locate) {
      interacted.current = true;
      following.current = true;
      if (props.fix)
        map.current?.easeTo({
          center: [props.fix.lon, props.fix.lat],
          zoom: 14,
        });
    }
  }, [props.locate]);
  useEffect(() => {
    if (following.current && props.fix)
      map.current?.easeTo({
        center: [props.fix.lon, props.fix.lat],
        duration: 250,
      });
  }, [props.fix]);
  useEffect(() => {
    if (props.selected) {
      const [x, y] = props.selected.cell.split(":").map(Number);
      map.current?.easeTo({
        center: ll(x * 500 + 250, y * 500 + 250),
        zoom: 14,
      });
    }
  }, [props.selected?.id]);
  return (
    <div
      className="map-view"
      ref={root}
      role="region"
      aria-label="Delhi community map"
    />
  );
}
