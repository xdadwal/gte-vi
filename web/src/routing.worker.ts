/// <reference lib="webworker" />
import {
  routeGraph,
  snapGraph,
  type Graph,
  type Node,
  type Zone,
} from "./routing";
import { xy, ll, cellsAround, isOpen, openThrough, type Refuge } from "./model";
type Request = {
  id: number;
  origin: { lon: number; lat: number };
  refuges: Refuge[];
  zones: Zone[];
  now: number;
  settings?: { walkingMaxMeters: number; walkingSpeedKmh: number };
};
const cache = new Map<string, Graph>();
self.onmessage = async (e: MessageEvent<Request>) => {
  const request = e.data;
  const max = request.settings?.walkingMaxMeters ?? 3000,
    speed = (request.settings?.walkingSpeedKmh ?? 4) * 1000;
  try {
    const response = await fetch("/api/v1/routing/manifest.json");
    if (!response.ok) throw new Error("Walking-network data is not available.");
    const manifest = (await response.json()) as {
      version: string;
      tiles: Record<string, string>;
    };
    const origin = xy(request.origin.lon, request.origin.lat),
      cells = cellsAround(origin, max + 100),
      nodes = new Map<string, Node>(),
      edges = new Map<string, Graph["edges"][number]>();
    let index = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (index < cells.length) {
          const cell = cells[index++],
            file = manifest.tiles[cell];
          if (!file) continue;
          let tile = cache.get(file);
          if (!tile) {
            const r = await fetch("/api/v1/routing/" + file);
            if (!r.ok)
              throw new Error(
                "Some walking-network tiles could not be loaded. Retry when connected.",
              );
            tile = (await r.json()) as Graph;
            cache.set(file, tile);
            if (cache.size > 300) cache.delete(cache.keys().next().value!);
          }
          for (const n of tile.nodes) nodes.set(n.id, n);
          for (const edge of tile.edges) edges.set(edge.id, edge);
        }
      }),
    );
    const candidates = request.refuges.filter(
      (r) =>
        Math.hypot(
          xy(r.lon, r.lat).x - origin.x,
          xy(r.lon, r.lat).y - origin.y,
        ) <= max && isOpen(r, request.now),
    );
    if (!candidates.length) {
      self.postMessage({
        id: request.id,
        error: `No eligible walking route found within ${max / 1000} km.`,
      });
      return;
    }
    let graph: Graph = {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
    };
    graph = snapGraph(graph, [{ ...origin, id: "origin" }])!;
    if (!graph)
      throw new Error(
        "Could not connect your location to a mapped pedestrian path.",
      );
    const viable: Refuge[] = [];
    for (const r of candidates) {
      const snapped = snapGraph(graph, [
        { ...xy(r.lon, r.lat), id: "refuge:" + r.id },
      ]);
      if (snapped) {
        graph = snapped;
        viable.push(r);
      }
    }
    let remaining = viable;
    while (remaining.length) {
      const route = routeGraph(
        graph,
        "origin",
        remaining.map((r) => "refuge:" + r.id),
        request.zones,
        max,
      );
      if (!route) break;
      const refuge = remaining.find(
        (r) => "refuge:" + r.id === route.nodes.at(-1),
      )!;
      if (
        !openThrough(
          refuge,
          request.now,
          request.now + (route.distance / speed) * 3600000,
        )
      ) {
        remaining = remaining.filter((r) => r.id !== refuge.id);
        continue;
      }
      const map = new Map(graph.nodes.map((n) => [n.id, n]));
      self.postMessage({
        id: request.id,
        route: {
          ...route,
          coordinates: route.nodes.map((id) => {
            const n = map.get(id)!;
            return ll(n.x, n.y);
          }),
          refuge,
          graphVersion: manifest.version,
        },
      });
      return;
    }
    self.postMessage({
      id: request.id,
      error: `No eligible walking route found within ${max / 1000} km.`,
    });
  } catch (error) {
    self.postMessage({
      id: request.id,
      error:
        error instanceof Error ? error.message : "Routing data unavailable.",
    });
  }
};
