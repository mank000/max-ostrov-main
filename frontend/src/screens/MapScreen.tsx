import { parseMapMessage, nearestVisibleEvents, type MapCenter } from '../features/map/messages'
import { useGeocoding } from '../useGeocoding'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { latestEvent, loadViewportEventsPage, type Event, type EventViewport } from '../api/events'
import { ApiError } from '../api/http'
import { searchCities, searchPlaces, type PlaceSuggestion } from '../api/places'
import { cityDisplayName, embeddedMapURL, type CityPin } from '../ui-utils'
import { Header, Icon, StatePanel } from '../ui/components/BasicUI'
import { EventRow, eventTime } from '../ui/components/ContentCards'
import { useExpandableSheet } from '../ui/components/useExpandableSheet'
import type { AppDataResult } from '../useAppData'
import { useMapLocation } from '../features/map/useMapLocation'
import './map.css'

export type MapFocusTarget = {
  eventId: number
  latitude: number
  longitude: number
  title: string
  startsAt: string
  category: string
}

export function MapScreen({
  city,
  cityName,
  theme,
  active,
  focusTarget,
  navigate,
  data,
}: {
  city: CityPin | null
  cityName: string
  theme: 'light' | 'dark'
  active: boolean
  focusTarget: MapFocusTarget | null
  navigate: (view: string, id?: number) => void
  data: AppDataResult
}) {
  const { autocomplete } = useGeocoding()
  const frame = useRef<HTMLIFrameElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const searchRequest = useRef<AbortController | null>(null)
  const cityLookupRequest = useRef<AbortController | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastBounds = useRef<EventViewport | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const visibleEvents = useMemo(
    () =>
      events
        .filter((event) => !data.deletedEventIds.has(event.id))
        .map((event) => latestEvent(event, data.eventOverrides[event.id])),
    [events, data.deletedEventIds, data.eventOverrides],
  )
  const [eventsLoading, setEventsLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState('')
  const [eventsError, setEventsError] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [nearbyOpen, setNearbyOpen] = useState(false)
  const closeChoices = useCallback(() => {
    setNearbyOpen(false)
    setSelected([])
  }, [])
  const {
    sheetRef: choicesSheetRef,
    handleProps: choicesHandleProps,
    expanded: choicesExpanded,
    reset: resetChoicesSheet,
  } = useExpandableSheet<HTMLDivElement>({ onClose: closeChoices })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlaceSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [resolvedCity, setResolvedCity] = useState<CityPin | null>(null)
  const [mapCenter, setMapCenter] = useState<MapCenter | null>(null)
  const activeCity = city || resolvedCity
  const hasSelectedCity = city !== null
  const selectedCityKey = city ? `${city.latitude}:${city.longitude}` : ''
  const previousSelectedCityKey = useRef(selectedCityKey)
  const activeCityLatitude = activeCity?.latitude
  const activeCityLongitude = activeCity?.longitude
  const activeCityName = activeCity?.name
  const mapCenterLatitude = mapCenter?.latitude
  const mapCenterLongitude = mapCenter?.longitude

  useEffect(() => {
    if (!nearbyOpen && selected.length === 0) {
      resetChoicesSheet()
    }
  }, [nearbyOpen, selected.length, resetChoicesSheet])

  const send = useCallback((message: object) => {
    frame.current?.contentWindow?.postMessage(message, window.location.origin)
  }, [])

  const geo = useMapLocation(active, ready, send)

  const loadEvents = useCallback((bounds: EventViewport) => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    lastBounds.current = bounds
    setEventsError('')
    setEventsLoading(true)
    const load = async () => {
      const result: Event[] = []
      let cursor = 0
      do {
        const page = await loadViewportEventsPage(bounds, controller.signal, cursor)
        result.push(...page.events)
        cursor = page.nextCursor || 0
      } while (cursor && result.length < 1000 && !controller.signal.aborted)
      if (!controller.signal.aborted) {
        setEvents(result)
      }
    }
    void load()
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setEventsError(
            cause instanceof Error ? cause.message : 'Не удалось загрузить мероприятия',
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setEventsLoading(false)
        }
      })
  }, [])

  useEffect(() => {
    const handler = (message: MessageEvent<unknown>) => {
      if (
        message.origin !== window.location.origin ||
        message.source !== frame.current?.contentWindow
      ) {
        return
      }
      const data = parseMapMessage(message.data)
      if (!data) {
        return
      }
      if (data.type === 'kutezh:map-ready') {
        setReady(true)
        setMapError('')
        send({ type: 'kutezh:visibility', active })
        send({
          type: 'kutezh:theme',
          scheme: theme,
          accent: '#007aff',
        })
      }
      if (data.type === 'kutezh:map-error') {
        setMapError('Не удалось загрузить карту')
      }
      if (data.type === 'kutezh:event-select' && data.eventId) {
        navigate('event', data.eventId)
      }
      if (data.type === 'kutezh:events-select' && Array.isArray(data.eventIds)) {
        setNearbyOpen(false)
        setSelected(data.eventIds)
      }
      if (
        data.type === 'kutezh:map-viewport' &&
        data.camera?.center &&
        Number.isFinite(data.camera.center.latitude) &&
        Number.isFinite(data.camera.center.longitude)
      ) {
        const next = data.camera.center
        setMapCenter((current) =>
          current &&
          Math.abs(current.latitude - next.latitude) < 0.000001 &&
          Math.abs(current.longitude - next.longitude) < 0.000001
            ? current
            : next,
        )
      }
      if (data.type === 'kutezh:map-viewport' && data.bounds && active) {
        loadEvents(data.bounds)
      }
    }
    window.addEventListener('message', handler)
    return () => {
      window.removeEventListener('message', handler)
      activeRequest.current?.abort()
      searchRequest.current?.abort()
      cityLookupRequest.current?.abort()
    }
  }, [active, theme, navigate, loadEvents, send])

  useEffect(() => {
    if (!active) {
      activeRequest.current?.abort()
    }
    if (!ready) {
      return
    }
    const update = requestAnimationFrame(() => send({ type: 'kutezh:visibility', active }))
    return () => cancelAnimationFrame(update)
  }, [active, ready, send])

  useEffect(() => () => send({ type: 'kutezh:visibility', active: false }), [send])

  useEffect(() => {
    if (!ready) {
      return
    }
    send({
      type: 'kutezh:theme',
      scheme: theme,
      accent: '#007aff',
    })
  }, [theme, ready, send])

  useEffect(() => {
    cityLookupRequest.current?.abort()
    if (hasSelectedCity || cityName.trim().length < 2) {
      setResolvedCity(null)
      return
    }

    setResolvedCity(null)
    const controller = new AbortController()
    cityLookupRequest.current = controller
    const value = cityName.trim()
    const run = () => searchCities(value, controller.signal)
    const load = async () => {
      let result: Awaited<ReturnType<typeof searchCities>>
      try {
        result = await run()
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 429 || controller.signal.aborted) {
          throw error
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1050))
        if (controller.signal.aborted) {
          return
        }
        result = await run()
      }
      if (controller.signal.aborted || !result?.length) {
        return
      }
      const key = value.toLocaleLowerCase('ru')
      const match =
        result.find((item) => cityDisplayName(item.name).toLocaleLowerCase('ru') === key) ||
        result[0]
      if (match) {
        setResolvedCity({
          name: cityDisplayName(match.name),
          latitude: match.latitude,
          longitude: match.longitude,
        })
      }
    }
    void load().catch(() => {})
    return () => controller.abort()
  }, [hasSelectedCity, cityName])

  useEffect(() => {
    if (previousSelectedCityKey.current === selectedCityKey) {
      return
    }
    previousSelectedCityKey.current = selectedCityKey
    searchRequest.current?.abort()
    setSearchQuery('')
    setSearchResults([])
    setSearchError('')
    setSearchOpen(false)
    setSearching(false)
  }, [selectedCityKey])

  useEffect(() => {
    if (
      ready &&
      active &&
      activeCityLatitude !== undefined &&
      activeCityLongitude !== undefined &&
      !focusTarget
    ) {
      send({
        type: 'kutezh:center',
        latitude: activeCityLatitude,
        longitude: activeCityLongitude,
      })
    }
  }, [activeCityLatitude, activeCityLongitude, focusTarget, ready, active, send])

  useEffect(() => {
    if (!ready || !active) {
      return
    }
    if (!focusTarget) {
      send({ type: 'kutezh:clear-event-focus' })
      return
    }
    searchRequest.current?.abort()
    setSearching(false)
    setSearchOpen(false)
    setSelected([])
    send({
      type: 'kutezh:focus-event',
      eventId: focusTarget.eventId,
      latitude: focusTarget.latitude,
      longitude: focusTarget.longitude,
    })
  }, [focusTarget, ready, active, send])

  useEffect(() => {
    if (!ready) {
      return
    }
    const mapped = visibleEvents
      .filter(
        (event) => event.location.latitude !== undefined && event.location.longitude !== undefined,
      )
      .map((event) => ({
        id: event.id,
        latitude: event.location.latitude,
        longitude: event.location.longitude,
        title: event.title,
        time: eventTime(event.starts_at),
        category: event.category,
      }))
    if (focusTarget) {
      const target = {
        id: focusTarget.eventId,
        latitude: focusTarget.latitude,
        longitude: focusTarget.longitude,
        title: focusTarget.title,
        time: eventTime(focusTarget.startsAt),
        category: focusTarget.category,
      }
      const index = mapped.findIndex((event) => event.id === focusTarget.eventId)
      if (index >= 0) {
        mapped[index] = target
      } else {
        mapped.push(target)
      }
    }
    send({ type: 'kutezh:events', events: mapped })
  }, [visibleEvents, focusTarget, ready, send])

  const performSearch = useCallback(
    async (rawValue: string, showShortError = false) => {
      const value = rawValue.trim()
      if (value.length < 2) {
        if (showShortError) {
          setSearchOpen(true)
          setSearchResults([])
          setSearchError('Введите хотя бы два символа')
        }
        return
      }
      if (value.length > 80) {
        setSearchOpen(true)
        setSearchResults([])
        setSearchError('Слишком длинный запрос')
        setSearching(false)
        return
      }

      const origin =
        activeCityLatitude !== undefined && activeCityLongitude !== undefined
          ? {
              name: activeCityName || cityName || 'Текущий город',
              latitude: activeCityLatitude,
              longitude: activeCityLongitude,
            }
          : mapCenterLatitude !== undefined && mapCenterLongitude !== undefined
            ? {
                name: cityName || 'Текущий город',
                latitude: mapCenterLatitude,
                longitude: mapCenterLongitude,
              }
            : null
      setSearchOpen(true)
      setSearchError('')
      if (!origin) {
        setSearchResults([])
        setSearching(false)
        setSearchError('Карта ещё загружается — поиск появится через мгновение')
        return
      }

      searchRequest.current?.abort()
      const controller = new AbortController()
      searchRequest.current = controller
      setSearching(true)
      const originName = cityName || origin.name
      const run = () =>
        searchPlaces(value, originName, origin.latitude, origin.longitude, controller.signal)
      try {
        let result: PlaceSuggestion[]
        try {
          result = await run()
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 429 || controller.signal.aborted) {
            throw error
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1100))
          if (controller.signal.aborted) {
            return
          }
          result = await run()
        }
        if (controller.signal.aborted || searchQuery.trim() !== value) {
          return
        }
        setSearchResults(result)
        if (!result.length) {
          setSearchError(`Ничего не найдено в регионе города ${originName}`)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setSearchResults([])
          setSearchError(error instanceof Error ? error.message : 'Поиск мест временно недоступен')
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false)
        }
      }
    },
    [
      activeCityLatitude,
      activeCityLongitude,
      activeCityName,
      cityName,
      mapCenterLatitude,
      mapCenterLongitude,
      searchQuery,
    ],
  )

  useEffect(() => {
    const value = searchQuery.trim()
    if (!autocomplete || !active || value.length < 2 || value.length > 80) {
      return
    }
    setSearchOpen(true)
    const timer = window.setTimeout(() => {
      void performSearch(value)
    }, 240)
    return () => window.clearTimeout(timer)
  }, [searchQuery, active, performSearch, autocomplete])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void performSearch(searchQuery, true)
  }

  function choosePlace(place: PlaceSuggestion) {
    searchRequest.current?.abort()
    searchInputRef.current?.blur()
    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
    setSearchError('')
    setSearching(false)
    send({
      type: 'kutezh:search-result',
      latitude: place.latitude,
      longitude: place.longitude,
    })
  }

  const cityResults = searchResults.filter((place) => place.scope === 'city')
  const regionResults = searchResults.filter((place) => place.scope !== 'city')
  const choices = visibleEvents.filter((event) => selected.includes(event.id))
  const nearbyEvents = useMemo(
    () => nearestVisibleEvents(visibleEvents, mapCenter || activeCity),
    [visibleEvents, mapCenter, activeCity],
  )

  const renderPlace = (place: PlaceSuggestion) => (
    <button
      type="button"
      className="map-search-result"
      key={`${place.latitude}:${place.longitude}:${place.title}`}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => choosePlace(place)}
    >
      <span className="map-search-result__icon">
        <Icon
          name={place.scope === 'city' ? 'location' : 'pin'}
          size={20}
        />
      </span>
      <span className="map-search-result__copy">
        <strong>{place.title}</strong>
        <small>{place.subtitle || [place.city, place.region].filter(Boolean).join(', ')}</small>
      </span>
      <Icon
        name="chevron"
        size={16}
      />
    </button>
  )

  return (
    <div className="map-screen">
      <iframe
        ref={frame}
        title="Карта мероприятий"
        src={embeddedMapURL(import.meta.env.VITE_MAP_URL)}
        className="map-frame"
        onLoad={() => {
          setReady(false)
          send({ type: 'kutezh:parent-ready' })
          send({ type: 'kutezh:theme', scheme: theme })
        }}
      />

      <div className="map-search-wrap">
        <search>
          <form
            className="map-search"
            onSubmit={submitSearch}
          >
            <button
              className="map-search__submit"
              type="submit"
              aria-label="Найти место"
              disabled={searching}
            >
              <Icon
                name="search"
                size={23}
              />
            </button>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => {
                const next = event.target.value
                const shouldSearch = next.trim().length >= 2
                searchRequest.current?.abort()
                setSearchQuery(next)
                setSearchError('')
                setSearchOpen(shouldSearch)
                setSearching(shouldSearch && autocomplete)
                if (!shouldSearch) {
                  setSearchResults([])
                }
              }}
              onFocus={() => {
                if (
                  searchQuery.trim().length >= 2 ||
                  searchResults.length ||
                  searchError ||
                  searching
                ) {
                  setSearchOpen(true)
                }
              }}
              placeholder="Адрес или место"
              aria-label="Поиск адреса или места"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            <span className="map-search__tail">
              {searching ? (
                <span
                  className="map-search__spinner"
                  role="status"
                  aria-label="Ищем"
                />
              ) : searchQuery ? (
                <button
                  className="map-search__clear"
                  type="button"
                  aria-label="Очистить поиск"
                  onClick={() => {
                    searchRequest.current?.abort()
                    setSearchQuery('')
                    setSearchResults([])
                    setSearchError('')
                    setSearchOpen(false)
                    setSearching(false)
                  }}
                >
                  <Icon
                    name="close"
                    size={18}
                  />
                </button>
              ) : null}
            </span>
          </form>
        </search>
        {searchOpen && (
          <div
            className="map-search-results"
            role="listbox"
            aria-label="Результаты поиска"
          >
            {cityResults.length > 0 && (
              <>
                <div className="map-search-results__title">
                  Сначала — {cityName || activeCity?.name}
                </div>
                {cityResults.map(renderPlace)}
              </>
            )}
            {regionResults.length > 0 && (
              <>
                <div className="map-search-results__title">
                  {cityResults.length ? 'Другие места региона' : 'В регионе'}
                </div>
                {regionResults.map(renderPlace)}
              </>
            )}
            {!autocomplete && !searching && !searchResults.length && !searchError && (
              <div className="map-search-status">Нажмите значок поиска или Enter.</div>
            )}
            {searching && !searchResults.length && (
              <div className="map-search-status">
                <span className="map-search__spinner" />
                Ищем в текущем регионе…
              </div>
            )}
            {!searching && searchError && (
              <div className="map-search-status map-search-status--error">{searchError}</div>
            )}
          </div>
        )}
      </div>
      <button
        className="map-city-button"
        type="button"
        aria-label={cityName ? `Выбрать город. Сейчас ${cityName}` : 'Выбрать город'}
        onClick={() => navigate('city')}
      >
        <Icon
          name="globe"
          size={25}
        />
      </button>

      <button
        className="map-nearby"
        type="button"
        aria-pressed={nearbyOpen}
        onClick={() => {
          setSelected([])
          setNearbyOpen((current) => !current)
        }}
      >
        События рядом · {visibleEvents.length}
      </button>
      <button
        className="map-location"
        type="button"
        aria-label="Моя геопозиция"
        aria-busy={geo.pending}
        aria-pressed={geo.tracking}
        onClick={() => void geo.locate()}
      >
        {geo.pending ? (
          <span className="map-search__spinner" />
        ) : (
          <Icon
            name="location"
            size={24}
          />
        )}
      </button>
      {(geo.pending ||
        geo.error ||
        (geo.tracking && geo.accuracy !== null && geo.accuracy > 100)) && (
        <div
          className="map-location-status"
          role={geo.error ? 'alert' : 'status'}
        >
          {geo.pending
            ? 'Определяем свежую геопозицию…'
            : geo.error ||
              `Приблизительная геопозиция · точность около ${Math.round(geo.accuracy!)} м`}
        </div>
      )}
      {mapError && (
        <div className="map-error">
          <StatePanel
            title="Не удалось загрузить карту"
            description={mapError}
            action="Повторить"
            onAction={() => frame.current?.contentWindow?.location.reload()}
          />
        </div>
      )}
      {eventsError && !mapError && (
        <div
          className="map-events-error"
          role="status"
        >
          <span>{eventsError}</span>
          <button
            type="button"
            onClick={() => {
              if (lastBounds.current) {
                loadEvents(lastBounds.current)
              }
            }}
          >
            Повторить
          </button>
        </div>
      )}
      {(nearbyOpen || choices.length > 0) && (
        <div
          ref={choicesSheetRef}
          className={`map-choices${nearbyOpen ? ' map-choices--nearby' : ''}`}
          data-sheet-expanded={choicesExpanded}
        >
          <button {...choicesHandleProps} />
          <Header
            title={nearbyOpen ? 'На этой части карты' : 'Мероприятия в этой точке'}
            back={closeChoices}
          />
          <div
            className="screen-scroll"
            data-sheet-scroll
          >
            {nearbyOpen && eventsLoading ? (
              <StatePanel
                title=""
                loading
              />
            ) : (nearbyOpen ? nearbyEvents : choices).length ? (
              (nearbyOpen ? nearbyEvents : choices).map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onClick={() => navigate('event', event.id)}
                />
              ))
            ) : (
              <StatePanel
                title="Пока нет мероприятий"
                description="Переместите карту или уменьшите масштаб."
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
