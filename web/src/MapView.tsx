import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type * as GeoJSON from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import type { Incident, Refuge, Fix } from "./model";
import { ll, REPORT_CELL_METERS } from "./model";
import { useSettings } from "./settings";
import { hotspotFeatures, severityColor, severityExpression } from "./hotspots";
type Props = {
  incidents: Incident[];
  exitCoordinates?: [number, number][];
  refuges: Refuge[];
  fix?: Fix | null;
  coordinates?: [number, number][];
  affected?: boolean;
  locate?: number;
  autoFollow?: boolean;
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
    following = useRef(props.autoFollow ?? false),
    interacted = useRef(false),
    initialViewApplied = useRef(revision > 0),
    markers = useRef<maplibregl.Marker[]>([]);
  const markerState = useRef<{
    props: Props;
    colors: string[];
  } | null>(null);
  latest.current = props;
  function update() {
    const m = map.current;
    if (!m || !ready.current) return;
    const p = latest.current;
    const config = settingsRef.current;
    const color = severityExpression(config.starColors);
    m.setPaintProperty("incident-hotspots", "fill-color", color);
    m.setPaintProperty("incident-hotspots", "fill-opacity", [
      "min",
      1,
      [
        "*",
        ["get", "opacityWeight"],
        [
          "case",
          ["==", ["get", "status"], "pending"],
          config.hotspotPendingOpacity,
          config.hotspotActiveOpacity,
        ],
      ],
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
    updateMarkers();
  }
  function updateMarkers() {
    const m = map.current;
    if (!m || !ready.current) return;
    const p = latest.current;
    const config = settingsRef.current;
    updateMarkerScale();
    const previous = markerState.current;
    if (
      previous?.props.incidents === p.incidents &&
      previous.props.refuges === p.refuges &&
      previous.props.entrance === p.entrance &&
      previous.colors === config.starColors
    )
      return;
    // Camera changes resize badge contents without replacing the touch targets.
    markerState.current = { props: p, colors: config.starColors };
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    for (const i of p.incidents) {
      const [x, y] = i.cell.split(":").map(Number);
      const center = ll(
        (x + 0.5) * REPORT_CELL_METERS,
        (y + 0.5) * REPORT_CELL_METERS,
      );
      const button = document.createElement("button");
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
      const badge = document.createElement("span");
      badge.className = "map-badge";
      badge.textContent =
        i.status === "active" ? `${i.average.toFixed(1)} ★` : "Pending";
      button.append(badge);
      button.setAttribute(
        "aria-label",
        i.status === "active"
          ? `Incident ${i.average.toFixed(1)} stars, ${i.count} reports`
          : `Pending incident, ${i.count} reports`,
      );
      button.onclick = () => latest.current.onSelect?.([i]);
      markers.current.push(
        new maplibregl.Marker({ element: button }).setLngLat(center).addTo(m),
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
  function updateMarkerScale() {
    const zoom = map.current?.getZoom();
    if (zoom === undefined) return;
    // At zoom 14+, badges are 30% smaller than the previous 64/76 x 44px
    // cards. Zooming out reduces only the badge, never the report footprint.
    const scale = 0.56 + Math.max(0, Math.min(1, (zoom - 11) / 3)) * 0.14;
    root.current?.style.setProperty("--map-badge-scale", String(scale));
  }
  useEffect(() => {
    const m = new maplibregl.Map({
      container: root.current!,
      style:
        import.meta.env.VITE_MAP_STYLE ||
        "https://tiles.openfreemap.org/styles/positron",
      center:
        props.autoFollow && props.fix
          ? [props.fix.lon, props.fix.lat]
          : [config.mapLon, config.mapLat],
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
          "fill-opacity": 0,
          "fill-antialias": false,
        },
      });
      m.addLayer({
        id: "incident-fill",
        type: "fill",
        source: "incidents",
        paint: {
          "fill-color": severityColor,
          // Keep the complete footprint clickable without a visible boundary.
          "fill-opacity": 0,
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
    let markerFrame = 0;
    const refreshMarkers = () => {
      if (markerFrame) return;
      markerFrame = requestAnimationFrame(() => {
        markerFrame = 0;
        updateMarkerScale();
      });
    };
    m.on("zoom", refreshMarkers);
    m.on("moveend", bounds);
    m.on("movestart", (event) => {
      if (event.originalEvent) {
        interacted.current = true;
        following.current = false;
      }
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
      cancelAnimationFrame(markerFrame);
      markerState.current = null;
      markers.current.forEach((m) => m.remove());
      ready.current = false;
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(update, [
    config,
    props.incidents,
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
      if (!interacted.current)
        map.current?.jumpTo({
          center:
            latest.current.autoFollow && latest.current.fix
              ? [latest.current.fix.lon, latest.current.fix.lat]
              : [config.mapLon, config.mapLat],
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
  }, [props.fix, props.autoFollow]);
  useEffect(() => {
    if (props.selected) {
      const [x, y] = props.selected.cell.split(":").map(Number);
      map.current?.easeTo({
        center: ll(
          x * REPORT_CELL_METERS + REPORT_CELL_METERS / 2,
          y * REPORT_CELL_METERS + REPORT_CELL_METERS / 2,
        ),
        zoom: Math.max(14, map.current?.getZoom() || 0),
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
