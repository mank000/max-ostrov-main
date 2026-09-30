const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'street',
  'street_limited',
  'service',
]
const PATH_SUBCLASSES = ['path', 'footway', 'cycleway', 'pedestrian', 'steps', 'bridleway']
const ROAD_FILTER = ['match', ['get', 'class'], ROAD_CLASSES, true, false]
const PATH_FILTER = [
  'any',
  ['match', ['get', 'class'], ['path', 'track'], true, false],
  ['match', ['get', 'subclass'], PATH_SUBCLASSES, true, false],
]
const RAIL_FILTER = ['match', ['get', 'class'], ['rail', 'transit'], true, false]
const CENTERLINE_FILTER = [
  'all',
  ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary'], true, false],
  ['match', ['get', 'oneway'], [1, -1], false, true],
  ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true],
]
const NORMAL_ROADS = [
  'all',
  ROAD_FILTER,
  ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true],
]
const BRIDGES = ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'bridge']]
const TUNNELS = ['all', ROAD_FILTER, ['==', ['get', 'brunnel'], 'tunnel']]

function classWidth(motorway, primary, arterial, local, service) {
  return [
    'match',
    ['get', 'class'],
    ['motorway', 'trunk'],
    motorway,
    'primary',
    primary,
    ['secondary', 'tertiary'],
    arterial,
    'service',
    service,
    local,
  ]
}

function widthModifier() {
  return [
    'case',
    ['==', ['get', 'ramp'], 1],
    0.62,
    ['match', ['get', 'service'], ['driveway', 'alley', 'parking_aisle'], 0.72, 1],
  ]
}

function roadWidthAt(motorway, primary, arterial, local, service, casing = 0) {
  return [
    '+',
    ['*', classWidth(motorway, primary, arterial, local, service), widthModifier()],
    casing,
  ]
}

function roadWidth() {
  return [
    'interpolate',
    ['exponential', 1.35],
    ['zoom'],
    8,
    roadWidthAt(2.0, 1.5, 1.0, 0.55, 0.4),
    12,
    roadWidthAt(5.0, 4.0, 3.0, 1.8, 1.2),
    15,
    roadWidthAt(15.0, 11.0, 8.0, 5.5, 4.0),
    18,
    roadWidthAt(32.0, 25.0, 18.0, 12.0, 8.0),
    19,
    roadWidthAt(42.0, 33.0, 24.0, 16.0, 11.0),
  ]
}

function roadCasingWidth() {
  return [
    'interpolate',
    ['exponential', 1.35],
    ['zoom'],
    8,
    roadWidthAt(2.0, 1.5, 1.0, 0.55, 0.4, 0.8),
    12,
    roadWidthAt(5.0, 4.0, 3.0, 1.8, 1.2, 1.2),
    15,
    roadWidthAt(15.0, 11.0, 8.0, 5.5, 4.0, 1.7),
    18,
    roadWidthAt(32.0, 25.0, 18.0, 12.0, 8.0, 2.4),
    19,
    roadWidthAt(42.0, 33.0, 24.0, 16.0, 11.0, 2.8),
  ]
}

function roadColor(colors) {
  return [
    'match',
    ['get', 'class'],
    ['motorway', 'trunk'],
    colors.roadMajor,
    'primary',
    colors.roadPrimary,
    ['secondary', 'tertiary'],
    colors.roadSecondary,
    'service',
    colors.roadService,
    colors.roadLocal,
  ]
}

function roadCasingColor(colors) {
  return [
    'match',
    ['get', 'class'],
    ['motorway', 'trunk', 'primary'],
    colors.roadMajorEdge,
    colors.roadEdge,
  ]
}

function pathWidth() {
  return [
    'interpolate',
    ['exponential', 1.25],
    ['zoom'],
    12,
    0.45,
    14,
    0.9,
    16,
    2.0,
    18,
    4.0,
    19,
    5.5,
  ]
}

function pathCasingWidth() {
  return [
    'interpolate',
    ['exponential', 1.25],
    ['zoom'],
    12,
    1.35,
    14,
    1.8,
    16,
    2.9,
    18,
    4.9,
    19,
    6.4,
  ]
}

function beforeSymbols(map) {
  return map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id
}

function transportationSource(map) {
  const layer = map
    .getStyle()
    ?.layers?.find(
      (item) =>
        item.type === 'line' &&
        item['source-layer'] === 'transportation' &&
        typeof item.source === 'string',
    )
  return layer?.source || null
}

export function hideBaseTransportation(style) {
  let source = null
  for (const layer of style.layers || []) {
    if (layer.type !== 'line' || layer['source-layer'] !== 'transportation') continue
    if (!source && typeof layer.source === 'string') source = layer.source
    const description = `${layer.id} ${JSON.stringify(layer.filter || '')}`.toLowerCase()
    if (/ferry|aerialway/.test(description)) continue
    layer.layout = { ...(layer.layout || {}), visibility: 'none' }
  }
  return source
}

export function applyRoadTheme(map, colors) {
  const updates = [
    ['max-road-tunnel-casing', colors.roadTunnelEdge],
    ['max-road-tunnel', roadColor(colors)],
    ['max-rail-casing', colors.railEdge],
    ['max-rail', colors.rail],
    ['max-road-surface-casing', roadCasingColor(colors)],
    ['max-road-surface', roadColor(colors)],
    ['max-road-centerline', colors.roadMarking],
    ['max-path-casing', colors.pathEdge],
    ['max-path', colors.path],
    ['max-road-bridge-casing', colors.roadBridgeEdge],
    ['max-road-bridge', roadColor(colors)],
  ]
  for (const [id, color] of updates) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color)
  }
}

export function installRoadLayers(map, colors) {
  if (map.getLayer?.('max-road-surface')) return true
  const source = transportationSource(map)
  if (!source) return false
  const before = beforeSymbols(map)
  const add = (layer) => map.addLayer(layer, before)
  const layout = { 'line-cap': 'round', 'line-join': 'round' }

  add({
    id: 'max-road-tunnel-casing',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: TUNNELS,
    minzoom: 8,
    layout,
    paint: {
      'line-color': colors.roadTunnelEdge,
      'line-width': roadCasingWidth(),
      'line-opacity': 0.42,
    },
  })
  add({
    id: 'max-road-tunnel',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: TUNNELS,
    minzoom: 8,
    layout,
    paint: {
      'line-color': roadColor(colors),
      'line-width': roadWidth(),
      'line-opacity': 0.48,
    },
  })

  add({
    id: 'max-rail-casing',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: RAIL_FILTER,
    minzoom: 11,
    layout,
    paint: {
      'line-color': colors.railEdge,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.1, 15, 2.4, 19, 4.2],
      'line-opacity': 0.72,
    },
  })
  add({
    id: 'max-rail',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: RAIL_FILTER,
    minzoom: 11,
    layout,
    paint: {
      'line-color': colors.rail,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 15, 1.15, 19, 2.0],
      'line-dasharray': [2, 2],
      'line-opacity': 0.9,
    },
  })

  add({
    id: 'max-road-surface-casing',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: NORMAL_ROADS,
    minzoom: 7,
    layout,
    paint: {
      'line-color': roadCasingColor(colors),
      'line-width': roadCasingWidth(),
      'line-opacity': 1,
    },
  })
  add({
    id: 'max-road-surface',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: NORMAL_ROADS,
    minzoom: 7,
    layout,
    paint: {
      'line-color': roadColor(colors),
      'line-width': roadWidth(),
      'line-opacity': 1,
    },
  })

  add({
    id: 'max-road-centerline',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: CENTERLINE_FILTER,
    minzoom: 14.5,
    layout,
    paint: {
      'line-color': colors.roadMarking,
      'line-width': ['interpolate', ['linear'], ['zoom'], 14.5, 0.35, 17, 0.72, 19, 1.05],
      'line-dasharray': [4, 4],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0.35, 16, 0.62, 18, 0.82],
    },
  })

  add({
    id: 'max-path-casing',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: PATH_FILTER,
    minzoom: 12,
    layout,
    paint: {
      'line-color': colors.pathEdge,
      'line-width': pathCasingWidth(),
      'line-opacity': 0.92,
    },
  })
  add({
    id: 'max-path',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: PATH_FILTER,
    minzoom: 12,
    layout,
    paint: {
      'line-color': colors.path,
      'line-width': pathWidth(),
      'line-opacity': 0.98,
    },
  })

  add({
    id: 'max-road-bridge-casing',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: BRIDGES,
    minzoom: 7,
    layout,
    paint: {
      'line-color': colors.roadBridgeEdge,
      'line-width': roadCasingWidth(),
      'line-opacity': 1,
    },
  })
  add({
    id: 'max-road-bridge',
    type: 'line',
    source,
    'source-layer': 'transportation',
    filter: BRIDGES,
    minzoom: 7,
    layout,
    paint: {
      'line-color': roadColor(colors),
      'line-width': roadWidth(),
      'line-opacity': 1,
    },
  })
  return true
}
