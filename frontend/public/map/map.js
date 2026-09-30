import { installTouchPitch } from './touch-pitch.js'
import { installGlobalBuildings, installRoads, loadStyle, palette } from './style.js'
import { highlightEvent, installEvents, renderEvents } from './events.js'

const CAMERA_KEY = 'kutezh-map-camera'
const motion = matchMedia('(prefers-reduced-motion: reduce)')
const loading = document.getElementById('loading')
const status = document.getElementById('status')
const compass = document.getElementById('compass')
const modeButton = document.getElementById('mode')
const abort = new AbortController()
let map
let ready = false
let active = parent === window
let picker = false
let pointMarker
let searchMarker
let locationMarker
let followingLocation = false
let events = []
let theme = 'light'
let lastViewport = ''
let cityKey = ''
let focusedEventID = null
let themeRevision = 0
let currentStyleTheme = 'light'

function notify(type, detail = {}) {
  if (parent !== window) parent.postMessage({ type, ...detail }, location.origin)
}

function validPoint(value) {
  return (
    Number.isFinite(value?.latitude) &&
    Number.isFinite(value?.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180
  )
}

function storedCamera() {
  try {
    const saved = localStorage.getItem(CAMERA_KEY)
    const value = JSON.parse(saved || 'null')
    if (!validPoint(value?.center) || !Number.isFinite(value.zoom)) return null
    return {
      center: value.center,
      zoom: Math.max(3, Math.min(19, value.zoom)),
      pitch: Number.isFinite(value.pitch) ? Math.max(0, Math.min(72, value.pitch)) : 0,
      bearing: Number.isFinite(value.bearing) ? value.bearing % 360 : 0,
      cityKey: typeof value.cityKey === 'string' ? value.cityKey : '',
    }
  } catch {}
  return null
}

function publishViewport() {
  if (!ready || !active || picker) return
  const bounds = map.getBounds()
  const center = map.getCenter()
  const camera = {
    center: { latitude: center.lat, longitude: center.lng },
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    cityKey,
  }
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify(camera))
  } catch {}
  const box = {
    west: Math.max(-180, bounds.getWest()),
    south: Math.max(-90, bounds.getSouth()),
    east: Math.min(180, bounds.getEast()),
    north: Math.min(90, bounds.getNorth()),
  }
  const key = Object.values(box)
    .map((value) => value.toFixed(4))
    .join(':')
  if (key !== lastViewport) {
    lastViewport = key
    notify('kutezh:map-viewport', { bounds: box, camera })
  }
}

function createMarker(size, color) {
  const element = document.createElement('div')
  element.className = 'map-point-marker'
  element.style.width = size + 'px'
  element.style.height = size + 'px'
  element.style.background = color
  return element
}

function showPickerPoint(value) {
  pointMarker?.remove()
  if (validPoint(value) && map) {
    pointMarker = new maplibregl.Marker({
      element: createMarker(22, '#2473e8'),
    })
      .setLngLat([value.longitude, value.latitude])
      .addTo(map)
  }
}

function showSearchPoint(value) {
  searchMarker?.remove()
  if (validPoint(value) && map) {
    searchMarker = new maplibregl.Marker({
      element: createMarker(24, '#0a84ff'),
    })
      .setLngLat([value.longitude, value.latitude])
      .addTo(map)
  }
}

function showLocation(value) {
  if (!ready || !map || !active || !validPoint(value)) return
  if (value.focus) followingLocation = true
  if (!locationMarker) {
    locationMarker = new maplibregl.Marker({ element: createMarker(18, '#2e85f3') })
      .setLngLat([value.longitude, value.latitude]).addTo(map)
  } else locationMarker.setLngLat([value.longitude, value.latitude])
  locationMarker.getElement().title = Number.isFinite(value.accuracy) ? `Точность около ${Math.round(value.accuracy)} м` : 'Моя геопозиция'
  if (followingLocation && !picker) {
    map.easeTo({ center: [value.longitude, value.latitude], zoom: value.focus ? Math.max(map.getZoom(), 15) : map.getZoom(), duration: motion.matches ? 0 : value.focus ? 650 : 350 })
  }
}

function refreshTheme() {
  const revision = ++themeRevision
  if (!ready || theme === currentStyleTheme) return
  const targetTheme = theme
  void loadStyle(targetTheme, abort.signal)
    .then((style) => {
      if (revision !== themeRevision || abort.signal.aborted || style.metadata?.['max:fallback'])
        return
      currentStyleTheme = targetTheme
      map.setStyle(style, { diff: false })
    })
    .catch((error) => console.warn('Не удалось сменить тему карты', error))
}

async function start() {
  try {
    const initialTheme = theme
    const style = await loadStyle(initialTheme, abort.signal)
    if (abort.signal.aborted) return
    currentStyleTheme = initialTheme
    const camera = storedCamera()
    cityKey = camera?.cityKey || ''
    map = new maplibregl.Map({
      container: 'map',
      style,
      center: camera ? [camera.center.longitude, camera.center.latitude] : [83.773, 53.3538],
      zoom: camera?.zoom ?? 15.7,
      pitch: camera?.pitch ?? 0,
      bearing: camera?.bearing ?? 0,
      minZoom: 3,
      maxZoom: 19,
      maxPitch: 72,
      touchPitch: false,
      cooperativeGestures: false,
      renderWorldCopies: false,
      fadeDuration: 0,
      maxTileCacheSize: 96,
      canvasContextAttributes: {
        antialias: true,
        powerPreference: 'high-performance',
      },
    })
    installTouchPitch(map)
    map.on('styleimagemissing', ({ id }) => {
      if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
    })
    const installLayers = () => {
      installRoads(map, theme)
      if (!map.getLayer('max-global-buildings')) installGlobalBuildings(map, theme)
      if (!map.getSource('kutezhs-source')) installEvents(map, palette(theme), notify)
      renderEvents(map, events)
      highlightEvent(map, focusedEventID)
    }
    map.on('style.load', installLayers)
    map.on('load', () => {
      installLayers()
      ready = true
      loading.hidden = true
      if (style.metadata?.['max:fallback']) {
        status.textContent = 'Подложка карты временно недоступна'
        status.hidden = false
      } else status.hidden = true
      notify('kutezh:map-ready')
      publishViewport()
      refreshTheme()
    })
    map.on('dragstart', () => { followingLocation = false })
    map.on('zoomstart', (event) => { if (event.originalEvent) followingLocation = false })
    map.on('moveend', () => {
      compass.firstElementChild.style.transform = 'rotate(' + -map.getBearing() + 'deg)'
      modeButton.setAttribute('aria-pressed', map.getPitch() > 5 ? 'true' : 'false')
      modeButton.textContent = map.getPitch() > 5 ? '2D' : '3D'
      modeButton.setAttribute('aria-label', map.getPitch() > 5 ? 'Плоская карта' : 'Объёмная карта')
      publishViewport()
    })
    map.on('click', (event) => {
      if (!picker) return
      const selected = {
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      }
      showPickerPoint(selected)
      notify('kutezh:point-select', selected)
    })
    map.on('error', (event) => {
      console.error('Kutezh Map:', event.error || event)
      if (!ready) notify('kutezh:map-error')
    })
    compass.addEventListener('click', () =>
      map.easeTo({ bearing: 0, duration: motion.matches ? 0 : 360 }),
    )
    modeButton.addEventListener('click', () => {
      const raised = map.getPitch() > 5
      map.easeTo({
        pitch: raised ? 0 : 52,
        bearing: raised ? 0 : -15,
        duration: motion.matches ? 0 : 420,
      })
    })
  } catch (error) {
    if (abort.signal.aborted) return
    console.error('Kutezh Map:', error)
    loading.textContent = 'Карта не загрузилась. Проверьте подключение.'
    status.textContent = error instanceof Error ? error.message : 'Ошибка загрузки карты'
    status.hidden = false
    notify('kutezh:map-error')
  }
}

addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent) return
  const data = event.data
  if (data?.type === 'kutezh:parent-ready') {
    if (ready) notify('kutezh:map-ready')
    return
  }
  if (data?.type === 'kutezh:visibility') {
    active = data.active === true
    if (active) {
      map?.resize()
      publishViewport()
    } else {
      lastViewport = ''
      map?.stop()
    }
    return
  }
  if (data?.type === 'kutezh:theme') {
    const nextTheme = data.scheme === 'dark' ? 'dark' : 'light'
    if (nextTheme !== theme) {
      theme = nextTheme
      document.body.dataset.theme = theme
      refreshTheme()
    }
    return
  }
  if (data?.type === 'kutezh:events' && Array.isArray(data.events)) {
    events = data.events
    if (ready) renderEvents(map, events)
    return
  }
  if (data?.type === 'kutezh:clear-event-focus' && ready) {
    focusedEventID = null
    highlightEvent(map, null)
    return
  }
  if (
    data?.type === 'kutezh:focus-event' &&
    ready &&
    validPoint(data) &&
    Number.isSafeInteger(data.eventId) &&
    data.eventId > 0
  ) {
    followingLocation = false
    focusedEventID = data.eventId
    searchMarker?.remove()
    searchMarker = undefined
    highlightEvent(map, data.eventId)
    map.easeTo({
      center: [data.longitude, data.latitude],
      zoom: Math.max(16.1, Math.min(map.getZoom(), 17.2)),
      duration: motion.matches ? 0 : 620,
    })
    return
  }
  if (data?.type === 'kutezh:center' && ready && validPoint(data)) {
    followingLocation = false
    focusedEventID = null
    highlightEvent(map, null)
    searchMarker?.remove()
    searchMarker = undefined
    const nextCityKey = data.latitude.toFixed(4) + ':' + data.longitude.toFixed(4)
    if (nextCityKey === cityKey) return
    cityKey = nextCityKey
    map.easeTo({
      center: [data.longitude, data.latitude],
      zoom: Math.max(13, Math.min(map.getZoom(), 15.4)),
      duration: motion.matches ? 0 : 550,
    })
    return
  }
  if (data?.type === 'kutezh:search-result' && ready && validPoint(data)) {
    followingLocation = false
    focusedEventID = null
    highlightEvent(map, null)
    showSearchPoint(data)
    map.easeTo({
      center: [data.longitude, data.latitude],
      zoom: Math.max(map.getZoom(), 16.2),
      duration: motion.matches ? 0 : 520,
    })
    return
  }
  if (data?.type === 'kutezh:picker') {
    picker = data.enabled === true
    showPickerPoint(data.point)
    if (picker && ready && validPoint(data.point)) {
      map.easeTo({
        center: [data.point.longitude, data.point.latitude],
        zoom: Math.max(map.getZoom(), 15),
        duration: motion.matches ? 0 : 450,
      })
    }
    return
  }
  if (data?.type === 'kutezh:location-update' && ready && active) {
    if (data.focus) { focusedEventID = null; highlightEvent(map, null) }
    showLocation(data)
  }
})

addEventListener('pagehide', (event) => {
  if (event.persisted) return
  abort.abort()
  pointMarker?.remove()
  searchMarker?.remove()
  locationMarker?.remove()
  map?.remove()
})

start()
