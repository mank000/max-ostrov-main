import { hideBaseTransportation, installRoadLayers } from './road-style.js'

const BASE_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const PALETTES = {
  light: {
    ground: '#f5f6f2',
    land: '#eef1eb',
    park: '#c8e8bd',
    forest: '#a8d1a2',
    water: '#addbea',
    roadMajor: '#b8bfbb',
    roadPrimary: '#c4cbc6',
    roadSecondary: '#cdd3ce',
    roadLocal: '#dce0dc',
    roadService: '#e5e7e2',
    roadEdge: '#b9c2bc',
    roadMajorEdge: '#aeb8b1',
    roadBridgeEdge: '#aab6af',
    roadTunnelEdge: '#d2d8d5',
    roadMarking: '#f8faf7',
    path: '#dfdacb',
    pathEdge: '#d1cbb9',
    graphRoad: '#bcc3bf',
    graphPath: '#e9e5d7',
    graphMarking: '#fbfcfa',
    rail: '#9aa5a1',
    railEdge: '#d3d8d5',
    building: '#d9d8d1',
    roof: '#ece9e1',
    buildingEdge: '#c5c7c1',
    text: '#34433d',
    halo: '#fbfcf9',
    event: '#2473e8',
    eventSurface: '#ffffff',
  },
  dark: {
    ground: '#20292e',
    land: '#273339',
    park: '#315744',
    forest: '#244c3c',
    water: '#27576d',
    roadMajor: '#69777d',
    roadPrimary: '#606e75',
    roadSecondary: '#58666d',
    roadLocal: '#505d64',
    roadService: '#48545a',
    roadEdge: '#303c42',
    roadMajorEdge: '#35434a',
    roadBridgeEdge: '#3d4c53',
    roadTunnelEdge: '#2d373c',
    roadMarking: '#8a9799',
    path: '#66665c',
    pathEdge: '#424b49',
    graphRoad: '#526168',
    graphPath: '#65655d',
    graphMarking: '#b4c4c3',
    rail: '#9aa5a3',
    railEdge: '#3d474a',
    building: '#697277',
    roof: '#7b8586',
    buildingEdge: '#4b5559',
    text: '#e7efeb',
    halo: '#253138',
    event: '#79aaff',
    eventSurface: '#27343a',
  },
}

export function palette(theme) {
  return PALETTES[theme === 'dark' ? 'dark' : 'light']
}

function paintFor(layer, colors) {
  const source = layer['source-layer']
  const description = `${layer.id} ${JSON.stringify(layer.filter || '')}`.toLowerCase()
  if (layer.type === 'background') return { 'background-color': colors.ground }
  if (layer.type === 'fill') {
    if (source === 'water') return { 'fill-color': colors.water }
    if (['landcover', 'landuse', 'park'].includes(source)) {
      const color = /forest|wood/.test(description)
        ? colors.forest
        : /park|grass|garden|recreation|meadow/.test(description)
          ? colors.park
          : colors.land
      return { 'fill-color': color }
    }
    if (source === 'building')
      return {
        'fill-color': colors.roof,
        'fill-outline-color': colors.buildingEdge,
      }
  }
  if (layer.type === 'line' && source === 'transportation') return null
  if (layer.type === 'symbol' && layer.paint?.['text-color']) {
    return { 'text-color': colors.text, 'text-halo-color': colors.halo }
  }
  return null
}

export async function loadStyle(theme, signal) {
  let style
  try {
    const response = await fetch(BASE_STYLE, { cache: 'force-cache', signal })
    if (!response.ok) throw new Error('Стиль карты недоступен: ' + response.status)
    style = await response.json()
    if (!style || !Array.isArray(style.layers) || !style.sources)
      throw new Error('Некорректный стиль карты')
  } catch (error) {
    if (signal?.aborted) throw error
    console.warn('Картографическая подложка недоступна', error)
    return {
      version: 8,
      metadata: { 'max:fallback': true },
      sources: {},
      layers: [
        {
          id: 'max-fallback-ground',
          type: 'background',
          paint: { 'background-color': palette(theme).ground },
        },
      ],
    }
  }
  const colors = palette(theme)
  hideBaseTransportation(style)
  style.layers = style.layers.filter(
    (layer) => !(layer.type === 'fill-extrusion' && layer['source-layer'] === 'building'),
  )
  for (const layer of style.layers) {
    const paint = paintFor(layer, colors)
    if (paint) layer.paint = { ...layer.paint, ...paint }
    if (
      layer.type === 'symbol' &&
      JSON.stringify(layer.layout?.['text-field'] || '').includes('name:nonlatin')
    ) {
      layer.layout['text-field'] = [
        'coalesce',
        ['get', 'name:nonlatin'],
        ['get', 'name'],
        ['get', 'name:latin'],
      ]
    }
  }
  return style
}

export function installRoads(map, theme) {
  return installRoadLayers(map, palette(theme))
}

function globalBuildingSource(map) {
  const layers = map.getStyle()?.layers || []
  for (const layer of layers) {
    if (layer['source-layer'] === 'building' && layer.source && map.getSource(layer.source)) {
      return layer.source
    }
  }
  return map.getSource('openmaptiles') ? 'openmaptiles' : null
}

export function installGlobalBuildings(map, theme) {
  const source = globalBuildingSource(map)
  if (!source) return false

  const colors = palette(theme)
  const before = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
  const height = [
    'max',
    3,
    ['coalesce', ['to-number', ['get', 'render_height']], ['to-number', ['get', 'height']], 7],
  ]
  const base = [
    'max',
    0,
    [
      'coalesce',
      ['to-number', ['get', 'render_min_height']],
      ['to-number', ['get', 'min_height']],
      0,
    ],
  ]
  const wallHeight = ['max', base, ['-', height, 0.24]]

  map.addLayer(
    {
      id: 'max-global-building-foundation',
      type: 'line',
      source,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'line-color': colors.buildingEdge,
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.25, 19, 0.8],
        'line-opacity': 0.72,
      },
    },
    before,
  )
  map.addLayer(
    {
      id: 'max-global-buildings',
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': colors.building,
        'fill-extrusion-height': wallHeight,
        'fill-extrusion-base': base,
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false,
      },
    },
    before,
  )
  map.addLayer(
    {
      id: 'max-global-building-roofs',
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 14.5,
      paint: {
        'fill-extrusion-color': colors.roof,
        'fill-extrusion-height': height,
        'fill-extrusion-base': wallHeight,
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false,
      },
    },
    before,
  )

  return true
}
