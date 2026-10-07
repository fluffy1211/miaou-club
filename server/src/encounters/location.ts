import proj4 from "proj4";
import { mainland } from "./mainland.js";
export type Cell = { size: 500 | 1000 | 2000; x: number; y: number };
const l93 =
  "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs";
export const forward = (lon: number, lat: number) =>
  proj4("EPSG:4326", l93, [lon, lat]);
export const inverse = (x: number, y: number) =>
  proj4(l93, "EPSG:4326", [x, y]);
function inside(point: number[], ring: number[][]) {
  let yes = false;
  for (let j = ring.length - 1, k = 0; k < ring.length; j = k++) {
    const a = ring[k],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
export function onMainland(lon: number, lat: number) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    mainland.some(
      (p) =>
        inside([lon, lat], p[0]) &&
        !p.slice(1).some((r) => inside([lon, lat], r)),
    )
  );
}
export function polygon(c: Cell) {
  const x = c.x * c.size,
    y = c.y * c.size;
  return [
    [x, y],
    [x + c.size, y],
    [x + c.size, y + c.size],
    [x, y + c.size],
    [x, y],
  ].map((p) => inverse(p[0], p[1]));
}
let projected: number[][][][] | undefined;
function touchesMainland(c: Cell) {
  projected ??= mainland.map((p) =>
    p.map((r) => r.map((v) => forward(v[0], v[1]))),
  );
  const xmin = c.x * c.size,
    ymin = c.y * c.size,
    xmax = xmin + c.size,
    ymax = ymin + c.size;
  function intersects(a: number[], b: number[]) {
    let lo = 0,
      hi = 1;
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const ps = [-dx, dx, -dy, dy],
      qs = [a[0] - xmin, xmax - a[0], a[1] - ymin, ymax - a[1]];
    for (let n = 0; n < 4; n++) {
      if (ps[n] === 0) {
        if (qs[n] < 0) return false;
        continue;
      }
      const t = qs[n] / ps[n];
      if (ps[n] < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
    return true;
  }
  return projected.some((p) =>
    p[0].some((a, n) => n > 0 && intersects(p[0][n - 1], a)),
  );
}
export function cell(value: unknown): Cell | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_location");
  const c = value as Cell;
  if (
    Object.keys(c).sort().join() !== "size,x,y" ||
    ![500, 1000, 2000].includes(c.size) ||
    !Number.isSafeInteger(c.x) ||
    !Number.isSafeInteger(c.y) ||
    c.x < 0 ||
    c.x > 2600 ||
    c.y < 3000 ||
    c.y > 14500
  )
    throw new Error("invalid_location");
  // Border cells must intersect the retained mainland polygons. Corners and
  // representative point cover interiors; segment intersection covers narrow
  // coastline cells and preserves enlargement at the border.
  const points = [
    ...polygon(c),
    inverse((c.x + 0.5) * c.size, (c.y + 0.5) * c.size),
  ];
  if (!points.some((p) => onMainland(p[0], p[1])) && !touchesMainland(c))
    throw new Error("invalid_location");
  return { size: c.size, x: c.x, y: c.y };
}
export function fromPosition(
  lon: number,
  lat: number,
  size: Cell["size"] = 1000,
  accuracy = 0,
): Cell {
  if (
    !onMainland(lon, lat) ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > size / 2
  )
    throw new Error("invalid_location");
  const [x, y] = forward(lon, lat);
  return cell({ size, x: Math.floor(x / size), y: Math.floor(y / size) })!;
}
export function enlarge(c: Cell, size: Cell["size"]): Cell {
  if (size < c.size || size % c.size !== 0) throw new Error("invalid_location");
  return cell({
    size,
    x: Math.floor((c.x * c.size) / size),
    y: Math.floor((c.y * c.size) / size),
  })!;
}
export function contains(old: Cell | null, next: Cell | null) {
  return (
    next === null ||
    (!!old &&
      next.size >= old.size &&
      next.x * next.size <= old.x * old.size &&
      next.y * next.size <= old.y * old.size &&
      (next.x + 1) * next.size >= (old.x + 1) * old.size &&
      (next.y + 1) * next.size >= (old.y + 1) * old.size)
  );
}
