const SOURCE = 'kutezhs-source'
const HIT = 'kutezhs-hit'
const CIRCLE_TRANSITION = { duration: 180, delay: 0 }
const boundMaps = new WeakSet()

export function renderEvents(map, events) {
  const features = events
    .filter(
      (event) =>
        Number.isSafeInteger(event?.id) &&
        event.id > 0 &&
        Number.isFinite(event.latitude) &&
        Number.isFinite(event.longitude) &&
        Math.abs(event.latitude) <= 90 &&
        Math.abs(event.longitude) <= 180,
    )
    .slice(0, 1000)
    .map((event) => ({
      type: 'Feature',
      properties: {
        id: event.id,
        title: event.title || '',
        time: event.time || '',
      },
      geometry: {
        type: 'Point',
        coordinates: [event.longitude, event.latitude],
      },
    }))
  map.getSource(SOURCE)?.setData({ type: 'FeatureCollection', features })
}

export function highlightEvent(map, eventId) {
  if (!map.getLayer('kutezhs-focus')) return
  const selectedId = Number.isSafeInteger(eventId) && eventId > 0 ? eventId : -1
  map.setFilter('kutezhs-focus', ['==', ['get', 'id'], selectedId])
}

export function installEvents(map, colors, notify) {
  map.addSource(SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 15,
    clusterRadius: 48,
  })
  const cluster = ['has', 'point_count']
  const single = ['!', cluster]
  map.addLayer({
    id: 'max-clusters-halo',
    type: 'circle',
    source: SOURCE,
    filter: cluster,
    paint: {
      'circle-color': colors.event,
      'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 27, 10, 31, 24, 34],
      'circle-opacity': 0.18,
      'circle-blur': 0.2,
      'circle-radius-transition': CIRCLE_TRANSITION,
      'circle-opacity-transition': CIRCLE_TRANSITION,
    },
  })
  map.addLayer({
    id: 'max-clusters',
    type: 'circle',
    source: SOURCE,
    filter: cluster,
    paint: {
      'circle-color': colors.event,
      'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 19, 10, 22, 24, 24],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
      'circle-radius-transition': CIRCLE_TRANSITION,
      'circle-stroke-width-transition': CIRCLE_TRANSITION,
    },
  })
  if (map.getStyle().glyphs)
    map.addLayer({
      id: 'max-cluster-count',
      type: 'symbol',
      source: SOURCE,
      filter: cluster,
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 13,
        'text-font': ['Noto Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    })
  map.addLayer({
    id: HIT,
    type: 'circle',
    source: SOURCE,
    filter: single,
    paint: { 'circle-radius': 28, 'circle-opacity': 0 },
  })
  map.addLayer({
    id: 'kutezhs-shadow',
    type: 'circle',
    source: SOURCE,
    filter: single,
    paint: {
      'circle-color': '#182b42',
      'circle-radius': 18,
      'circle-opacity': 0.2,
      'circle-blur': 0.7,
      'circle-translate': [0, 4],
      'circle-radius-transition': CIRCLE_TRANSITION,
      'circle-opacity-transition': CIRCLE_TRANSITION,
    },
  })
  map.addLayer({
    id: 'kutezhs-focus',
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', 'id'], -1],
    paint: {
      'circle-color': colors.event,
      'circle-radius': 24,
      'circle-opacity': 0.12,
      'circle-stroke-color': colors.event,
      'circle-stroke-width': 3,
      'circle-radius-transition': CIRCLE_TRANSITION,
      'circle-opacity-transition': CIRCLE_TRANSITION,
      'circle-stroke-width-transition': CIRCLE_TRANSITION,
    },
  })
  map.addLayer({
    id: 'kutezhs',
    type: 'circle',
    source: SOURCE,
    filter: single,
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': 15,
      'circle-stroke-color': colors.event,
      'circle-stroke-width': 3,
      'circle-radius-transition': CIRCLE_TRANSITION,
      'circle-stroke-width-transition': CIRCLE_TRANSITION,
    },
  })
  map.addLayer({
    id: 'kutezhs-core',
    type: 'circle',
    source: SOURCE,
    filter: single,
    paint: {
      'circle-color': colors.event,
      'circle-radius': 5,
      'circle-radius-transition': CIRCLE_TRANSITION,
    },
  })
  if (map.getStyle().glyphs)
    map.addLayer({
      id: 'kutezhs-time',
      type: 'symbol',
      source: SOURCE,
      filter: single,
      minzoom: 13,
      layout: {
        'text-field': ['get', 'time'],
        'text-size': 10,
        'text-font': ['Noto Sans Bold'],
        'text-offset': [0, 2.3],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': colors.text,
        'text-halo-color': colors.halo,
        'text-halo-width': 2,
      },
    })

  if (boundMaps.has(map)) return
  boundMaps.add(map)
  map.on('click', HIT, (event) => {
    const ids = [
      ...new Set(
        map
          .queryRenderedFeatures(event.point, { layers: [HIT] })
          .map((feature) => Number(feature.properties?.id))
          .filter(Number.isSafeInteger),
      ),
    ]
    if (ids.length === 1) notify('kutezh:event-select', { eventId: ids[0] })
    else if (ids.length) notify('kutezh:events-select', { eventIds: ids })
  })
  map.on('click', 'max-clusters', async (event) => {
    const feature = event.features?.[0]
    if (!feature) return
    const source = map.getSource(SOURCE)
    const clusterId = feature.properties?.cluster_id
    const count = Number(feature.properties?.point_count || 0)
    try {
      if (count <= 16) {
        const leaves = await source.getClusterLeaves(clusterId, count, 0)
        const ids = [
          ...new Set(
            leaves.map((leaf) => Number(leaf.properties?.id)).filter(Number.isSafeInteger),
          ),
        ]
        if (ids.length) {
          notify('kutezh:events-select', { eventIds: ids })
          return
        }
      }
      const zoom = await source.getClusterExpansionZoom(clusterId)
      map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 340 })
    } catch (error) {
      console.warn('Не удалось открыть группу мероприятий', error)
    }
  })
  for (const layer of [HIT, 'max-clusters']) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
    })
  }
}
