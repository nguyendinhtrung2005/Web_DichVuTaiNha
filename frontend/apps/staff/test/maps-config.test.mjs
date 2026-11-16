import test from 'node:test'
import assert from 'node:assert/strict'
import { staffMapsConfig } from '../lib/server/maps-config.mjs'

const osm = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

test('local QA defaults to canonical OSM while production requires an explicit provider', () => {
  assert.deepEqual(staffMapsConfig({ NODE_ENV: 'development' }), { tileUrl: osm, maxZoom: 19, providerName: null, providerUrl: null })
  assert.equal(staffMapsConfig({ NODE_ENV: 'production' }), null)
  assert.equal(staffMapsConfig({ STAFF_MAPS_ENABLED: 'false', STAFF_MAP_TILE_URL: osm }), null)
  assert.equal(staffMapsConfig({ NODE_ENV: 'production', STAFF_MAP_TILE_URL: osm }).tileUrl, osm)
  assert.equal(staffMapsConfig({ STAFF_GOOGLE_MAPS_BROWSER_KEY: 'old-key-must-not-reach-client' }).browserKey, undefined)
})

test('configured provider supports HTTPS and loopback self-hosting without HTML attribution', () => {
  assert.deepEqual(staffMapsConfig({ NODE_ENV: 'production', STAFF_MAP_TILE_URL: 'https://tiles.example.org/{z}/{x}/{y}.png', STAFF_MAP_TILE_MAX_ZOOM: '20', STAFF_MAP_TILE_PROVIDER_NAME: 'Provider', STAFF_MAP_TILE_PROVIDER_URL: 'https://tiles.example.org/' }), {
    tileUrl: 'https://tiles.example.org/{z}/{x}/{y}.png', maxZoom: 20, providerName: 'Provider', providerUrl: 'https://tiles.example.org/',
  })
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(staffMapsConfig({ STAFF_MAP_TILE_URL: `http://${host}:8080/{z}/{x}/{y}.png` }).tileUrl, `http://${host}:8080/{z}/{x}/{y}.png`)
})

test('rejects malformed templates, insecure external URLs, credentials and unsupported OSM variants', () => {
  for (const tileUrl of [
    'http://tiles.example.org/{z}/{x}/{y}.png', 'javascript:alert(1)',
    'https://user:secret@tiles.example.org/{z}/{x}/{y}.png',
    'https://tiles.example.org/{z}/{x}/{y}.png#fragment',
    'https://tiles.example.org/{z}/{x}.png', 'https://tiles.example.org/{z}/{x}/{y}/{y}.png',
    'https://tiles.example.org/{s}/{z}/{x}/{y}.png',
    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png?cache=bypass',
  ]) assert.equal(staffMapsConfig({ STAFF_MAP_TILE_URL: tileUrl }), null, tileUrl)
  for (const maxZoom of ['0', '20', '22', 'NaN', '19.5', '-1']) assert.equal(staffMapsConfig({ STAFF_MAP_TILE_URL: osm, STAFF_MAP_TILE_MAX_ZOOM: maxZoom }), null, maxZoom)
  assert.equal(staffMapsConfig({ STAFF_MAP_TILE_PROVIDER_NAME: '<script>bad</script>' }), null)
  assert.equal(staffMapsConfig({ STAFF_MAP_TILE_PROVIDER_NAME: 'Provider', STAFF_MAP_TILE_PROVIDER_URL: 'javascript:alert(1)' }), null)
  assert.equal(staffMapsConfig({ STAFF_MAP_TILE_PROVIDER_URL: 'https://provider.example.org' }), null)
})
