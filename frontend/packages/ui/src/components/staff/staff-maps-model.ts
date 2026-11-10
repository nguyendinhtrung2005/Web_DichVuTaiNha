export type StaffMapsConfig = { tileUrl: string; maxZoom: number; providerName: string | null; providerUrl: string | null }
export type MapPoint = { lat: number; lng: number }
export type ServicePolygon = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] }
export function branchPoint(latitude: unknown, longitude: unknown): MapPoint | null {
  if (typeof latitude !== "string" || typeof longitude !== "string" || !/^-?\d+(?:\.\d+)?$/.test(latitude) || !/^-?\d+(?:\.\d+)?$/.test(longitude)) return null
  const lat = Number(latitude), lng = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}
/** Bounded 2D GeoJSON only. Feature properties never enter the map or a tile request. */
export function servicePolygon(value: unknown): ServicePolygon | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  let points = 0
  function ring(value: unknown): value is number[][] {
    if (!Array.isArray(value) || value.length < 4 || value.length > 1000) return false
    for (const pair of value) { if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(n => typeof n === "number" && Number.isFinite(n)) || Math.abs(pair[0]) > 180 || Math.abs(pair[1]) > 90 || ++points > 5000) return false }
    if (value[0][0] !== value[value.length - 1][0] || value[0][1] !== value[value.length - 1][1]) return false
    return new Set(value.slice(0, -1).map(pair => pair.join(","))).size >= 3
  }
  function polygon(value: unknown): value is number[][][] { return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(ring) }
  function geometry(value: unknown): ServicePolygon | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const input = value as { type?: unknown; coordinates?: unknown }
    if (input.type === "Polygon" && polygon(input.coordinates)) return { type: "Polygon", coordinates: input.coordinates.map(r => r.map(p => [...p])) }
    if (input.type === "MultiPolygon" && Array.isArray(input.coordinates) && input.coordinates.length > 0 && input.coordinates.length <= 8 && input.coordinates.every(polygon)) return { type: "MultiPolygon", coordinates: input.coordinates.map(p => p.map(r => r.map(v => [...v]))) }
    return null
  }
  const input = value as { type?: unknown; geometry?: unknown; features?: unknown }
  if (input.type === "Feature") return geometry(input.geometry)
  if (input.type !== "FeatureCollection") return geometry(input)
  if (!Array.isArray(input.features) || !input.features.length || input.features.length > 8) return null
  const polygons: number[][][][] = []
  for (const feature of input.features) {
    if (!feature || typeof feature !== "object" || feature.type !== "Feature") return null
    const parsed = geometry(feature.geometry)
    if (!parsed) return null
    polygons.push(...(parsed.type === "Polygon" ? [parsed.coordinates] : parsed.coordinates))
    if (polygons.length > 8) return null
  }
  return { type: "MultiPolygon", coordinates: polygons }
}
