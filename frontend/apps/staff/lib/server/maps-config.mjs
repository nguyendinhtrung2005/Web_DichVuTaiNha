const osmTiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])

function publicUrl(value) {
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password || parsed.hash) return null
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback.has(parsed.hostname))) return null
    return parsed
  } catch { return null }
}

/** Browser-visible tile configuration only. No server credential belongs here. */
export function staffMapsConfig(env = process.env) {
  if (env.STAFF_MAPS_ENABLED === 'false') return null
  const configured = env.STAFF_MAP_TILE_URL
  const tileUrl = typeof configured === 'string' && configured.trim() ? configured.trim() : env.NODE_ENV === 'production' ? null : osmTiles
  if (!tileUrl || /\s/.test(tileUrl)) return null
  if (!['z', 'x', 'y'].every(token => tileUrl.split(`{${token}}`).length === 2) || /[{}]/.test(tileUrl.replace(/\{[zxy]\}/g, ''))) return null
  const parsed = publicUrl(tileUrl.replace(/\{[zxy]\}/g, '0'))
  if (!parsed) return null
  // OSM's public raster service requires this exact endpoint, without subdomains.
  const isOsm = parsed.hostname === 'tile.openstreetmap.org' || parsed.hostname.endsWith('.tile.openstreetmap.org')
  if (isOsm && tileUrl !== osmTiles) return null
  const zoom = env.STAFF_MAP_TILE_MAX_ZOOM
  const maxZoom = zoom === undefined || zoom === '' ? 19 : /^\d{1,2}$/.test(zoom) ? Number(zoom) : NaN
  if (!Number.isInteger(maxZoom) || maxZoom < 1 || maxZoom > (isOsm ? 19 : 22)) return null
  const providerName = typeof env.STAFF_MAP_TILE_PROVIDER_NAME === 'string' ? env.STAFF_MAP_TILE_PROVIDER_NAME.trim() : ''
  if (providerName.length > 120 || /[<>\x00-\x1f\x7f]/.test(providerName)) return null
  const providerValue = typeof env.STAFF_MAP_TILE_PROVIDER_URL === 'string' ? env.STAFF_MAP_TILE_PROVIDER_URL.trim() : ''
  if (providerValue && (!providerName || !publicUrl(providerValue))) return null
  return { tileUrl, maxZoom, providerName: providerName || null, providerUrl: providerValue || null }
}
