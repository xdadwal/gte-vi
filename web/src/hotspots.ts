import type { ExpressionSpecification } from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { Incident } from "./model";
import { ll } from "./model";

// Warm severity scale keeps refuges teal and walking routes blue.
export const STAR_COLORS = [
  "#b18a16",
  "#d89718",
  "#e16c25",
  "#d74435",
  "#a92d4c",
];
const activeColor: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "average"],
  ...STAR_COLORS.flatMap((color, index) => [index + 1, color]),
];

export const severityColor: ExpressionSpecification = [
  "case",
  ["==", ["get", "status"], "pending"],
  "#8b8170",
  activeColor,
];

export function hotspotFeatures(
  incidents: Incident[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: incidents.flatMap((incident) => {
      const [x, y] = incident.cell.split(":").map(Number);
      const center = ll(x * 500 + 250, y * 500 + 250);
      // Nested translucent contours approximate a soft gradient on the actual
      // zone footprint. No density weighting or invented larger danger radius.
      return Array.from({ length: 16 }, (_, index): GeoJSON.Feature => {
        const scale = 1 - index / 16;
        return {
          type: "Feature",
          properties: { average: incident.average, status: incident.status },
          geometry: {
            type: "Polygon",
            coordinates: incident.hotzone.coordinates.map((ring) =>
              ring.map(([lon, lat]) => [
                center[0] + (lon - center[0]) * scale,
                center[1] + (lat - center[1]) * scale,
              ]),
            ),
          },
        };
      });
    }),
  };
}
