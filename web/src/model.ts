import type * as GeoJSON from "geojson";
import proj4 from "proj4";
import { distanceToZone, pointInZone, type Node, type Zone } from "./routing";
export const UTM = "+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs";
export type Incident = {
  id: string;
  cell: string;
  status: "active" | "pending";
  count: number;
  average: number;
  buffer: number;
  revision: number;
  updatedAt: string;
  expiresAt: string;
  geometry: GeoJSON.Polygon;
  hotzone: GeoJSON.Polygon;
};
export type Refuge = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  instructions: string;
  hours: Record<string, [number, number][]>;
  exceptions: Record<string, [number, number][]>;
  closed: boolean;
  revision: number;
};
export type Overview = { lon: number; lat: number; count: number };
export type Snapshot = {
  overview?: Overview[];
  revisions?: Record<string, number>;
  incidents: Incident[];
  refuges: Refuge[];
  serverTime: string;
};
export type Fix = {
  lon: number;
  lat: number;
  accuracy: number;
  timestamp: number;
};
export function xy(lon: number, lat: number): Node {
  const [x, y] = proj4("EPSG:4326", UTM, [lon, lat]);
  return { id: "", x, y, lon, lat };
}
export function ll(x: number, y: number): [number, number] {
  return proj4(UTM, "EPSG:4326", [x, y]) as [number, number];
}
export function zone(i: Incident): Zone {
  const [x, y] = i.cell.split(":").map(Number);
  return { x: x * 500, y: y * 500, width: 500, height: 500, buffer: i.buffer };
}
export function cellsInBounds(
  west: number,
  south: number,
  east: number,
  north: number,
): string[] {
  const ps = [
      xy(west, south),
      xy(west, north),
      xy(east, south),
      xy(east, north),
    ],
    xmin = Math.floor(Math.min(...ps.map((p) => p.x)) / 500),
    xmax = Math.floor(Math.max(...ps.map((p) => p.x)) / 500),
    ymin = Math.floor(Math.min(...ps.map((p) => p.y)) / 500),
    ymax = Math.floor(Math.max(...ps.map((p) => p.y)) / 500);
  if ((xmax - xmin + 1) * (ymax - ymin + 1) > 1024) return [];
  const cells = [];
  for (let x = xmin; x <= xmax; x++)
    for (let y = ymin; y <= ymax; y++) cells.push(`${x}:${y}`);
  return cells;
}
export function cellsAround(p: Node, r: number) {
  const cells = [];
  for (
    let x = Math.floor((p.x - r) / 500);
    x <= Math.floor((p.x + r) / 500);
    x++
  )
    for (
      let y = Math.floor((p.y - r) / 500);
      y <= Math.floor((p.y + r) / 500);
      y++
    )
      cells.push(`${x}:${y}`);
  return cells;
}
export function isOpen(r: Refuge, at: number) {
  if (r.closed) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at),
    get = (k: string) => parts.find((p) => p.type === k)?.value || "",
    date = `${get("year")}-${get("month")}-${get("day")}`,
    day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      get("weekday"),
    ),
    minute = Number(get("hour")) * 60 + Number(get("minute"));
  const ranges = r.exceptions[date] ?? r.hours[String(day)] ?? [];
  return ranges.some(([a, b]) => minute >= a && minute < b);
}
export function refugeEligible(r: Refuge, inc: Incident[], at: number) {
  return (
    isOpen(r, at) && !inc.some((i) => pointInZone(xy(r.lon, r.lat), zone(i)))
  );
}
export type AlertMemory = {
  last: number;
  severity: number;
  inside: boolean;
  outsideSince?: number;
};
export function alertFor(
  i: Incident,
  p: Node,
  radius: number,
  now: number,
  old?: AlertMemory,
): { notify: boolean; memory: AlertMemory } {
  const memory = { last: 0, severity: 0, inside: false, ...old };
  const near = i.status === "active" && distanceToZone(p, zone(i)) <= radius;
  if (!near) {
    memory.outsideSince ??= now;
    if (now - memory.outsideSince >= 60000) memory.inside = false;
    return { notify: false, memory };
  }
  delete memory.outsideSince;
  const notify =
    (!memory.last || now - memory.last >= 300000) &&
    (!memory.inside || i.average - memory.severity >= 1 - 1e-9);
  if (notify || memory.inside) memory.inside = true;
  if (notify) {
    memory.last = now;
    memory.severity = i.average;
  }
  return { notify, memory };
}

export function openThrough(r: Refuge, start: number, end: number) {
  if (!isOpen(r, start) || !isOpen(r, end)) return false;
  for (let t = Math.floor(start / 60000) * 60000 + 60000; t < end; t += 60000)
    if (!isOpen(r, t)) return false;
  return true;
}
