// Reserve the widest badge plus a gap, including its 44px touch target.
// Grouping uses projected pixels, so labels separate as the map zooms in.
export function groupMapLabels<T>(points: { x: number; y: number; item: T }[]) {
  const width = 92,
    height = 52;
  const parent = points.map((_, index) => index);
  function root(index: number): number {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  const bins = new Map<string, number[]>();
  points.forEach((point, index) => {
    const column = Math.floor(point.x / width),
      row = Math.floor(point.y / height);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const neighbor of bins.get(`${column + dx}:${row + dy}`) || []) {
          const other = points[neighbor];
          if (
            Math.abs(point.x - other.x) < width &&
            Math.abs(point.y - other.y) < height
          )
            parent[root(index)] = root(neighbor);
        }
      }
    const key = `${column}:${row}`;
    const bucket = bins.get(key) || [];
    bucket.push(index);
    bins.set(key, bucket);
  });
  const groups = new Map<number, typeof points>();
  points.forEach((point, index) => {
    const key = root(index);
    const group = groups.get(key) || [];
    group.push(point);
    groups.set(key, group);
  });
  return [...groups.values()].map((group) => {
    const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
    const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
    // Anchor to a member nearest the centre. A computed centroid could collide
    // with another group's badge, even when none of its members overlap.
    const anchor = group.reduce((best, point) =>
      Math.hypot(point.x - x, point.y - y) < Math.hypot(best.x - x, best.y - y)
        ? point
        : best,
    );
    return { anchor: anchor.item, members: group.map((point) => point.item) };
  });
}
