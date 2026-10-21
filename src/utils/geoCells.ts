// Coarse location grid for "Nearby". Positions are snapped to the centre of a grid cell whose size
// the user chooses, so only a cell (never exact coordinates) is ever stored or published.

/** Area sizes a person may publish at (km). */
export const PRECISIONS = [1, 5, 25, 100, 500] as const;
export type Precision = (typeof PRECISIONS)[number];
/** Every grid level that exists on the network. Coarser levels let far-away searches stay cheap. */
export const LEVELS = [1, 5, 25, 100, 500, 2000, 20000] as const;
/** Search radii (km). 20000 = the whole planet. */
export const RADII = [1, 5, 25, 100, 500, 2000, 20000] as const;
export type RadiusKm = (typeof RADII)[number];

export interface GeoPoint { lat: number; lon: number }
export interface GeoCell extends GeoPoint { key: string; level: number }

const KM_PER_DEG = 111.32;
const EARTH_CIRCUMFERENCE_KM = 40075;
const rad = (d: number) => (d * Math.PI) / 180;

export function isPrecision(n: unknown): n is Precision {
  return (PRECISIONS as readonly number[]).includes(n as number);
}

/** Snap a point to its grid cell at `level` km. Rows are `level` km tall; columns tile each row evenly. */
export function cellFor(lat: number, lon: number, level: number): GeoCell {
  const la = Math.max(-89.9, Math.min(89.9, lat));
  const lo = ((((lon + 180) % 360) + 360) % 360) - 180;
  const dLat = level / KM_PER_DEG;
  const row = Math.floor((la + 90) / dLat);
  const centerLat = -90 + (row + 0.5) * dLat;
  const cols = Math.max(1, Math.floor((EARTH_CIRCUMFERENCE_KM * Math.cos(rad(centerLat))) / level));
  const col = Math.min(cols - 1, Math.floor(((lo + 180) / 360) * cols));
  const centerLon = -180 + (col + 0.5) * (360 / cols);
  return { key: `${level}_${row}_${col}`, level, lat: centerLat, lon: centerLon };
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Smallest published level that can cover a search radius (radius 25 → level 25 cells). */
export function levelForRadius(radiusKm: number): number {
  return LEVELS.find(l => l >= radiusKm) ?? LEVELS[LEVELS.length - 1];
}

/** Levels a person with precision `prec` publishes into: their own and every coarser one. */
export function levelsFrom(prec: number): number[] {
  return LEVELS.filter(l => l >= prec);
}

/** Distinct cells at `level` that can hold anyone within `radiusKm` of the point (capped, nearest first). */
export function cellsAround(p: GeoPoint, radiusKm: number, level: number, cap = 49): GeoCell[] {
  const step = Math.max(level * 0.8, 0.5);
  const span = radiusKm + level;
  const seen = new Map<string, GeoCell>();
  for (let dy = -span; dy <= span + 1e-9; dy += step) {
    const lat = p.lat + dy / KM_PER_DEG;
    const kmPerLon = KM_PER_DEG * Math.max(0.05, Math.cos(rad(Math.max(-89, Math.min(89, lat)))));
    for (let dx = -span; dx <= span + 1e-9; dx += step) {
      const c = cellFor(lat, p.lon + dx / kmPerLon, level);
      if (!seen.has(c.key)) seen.set(c.key, c);
    }
  }
  return [...seen.values()].sort((a, b) => haversineKm(p, a) - haversineKm(p, b)).slice(0, cap);
}

/** Friendly, deliberately blurry distance ("Within 5 km", "About 25 km"). */
export function distanceLabel(distKm: number, theirPrecision: number): string {
  if (distKm <= theirPrecision) return `Within ${theirPrecision} km`;
  const nice = distKm < 10 ? Math.ceil(distKm)
    : distKm < 100 ? Math.ceil(distKm / 5) * 5
    : distKm < 1000 ? Math.ceil(distKm / 50) * 50
    : Math.ceil(distKm / 100) * 100;
  return `About ${nice.toLocaleString()} km`;
}
