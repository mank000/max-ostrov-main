import { cityCatalog } from '../city-catalog'
import { useGeocoding } from '../useGeocoding'
import { requestLocation } from '../location'
import { reverseGeocode } from '../api/places'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError, request } from '../api/http'
import { cityDisplayName, validPoint, type CityPin } from '../ui-utils'
import { Cell, Header, Icon, SearchField, StatePanel } from '../ui/components/BasicUI'
import './extras.css'
import type { ScreenProps } from './screen-types'

function cityTitle(value: CityPin) {
  return cityDisplayName(value.name)
}

function cityKey(value: CityPin | string) {
  const name = typeof value === 'string' ? value : value.name
  return cityDisplayName(name).toLocaleLowerCase('ru')
}

function readCity(value: unknown): CityPin | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<CityPin>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  if (!name || name.length > 300 || !validPoint(candidate.latitude, candidate.longitude))
    return null
  return {
    name: cityTitle({
      name,
      latitude: candidate.latitude!,
      longitude: candidate.longitude!,
    }),
    latitude: candidate.latitude!,
    longitude: candidate.longitude!,
  }
}


export function CityScreen({ back, city, cityPin, setCityPin }: Pick<ScreenProps, 'back' | 'city' | 'cityPin' | 'setCityPin'>) {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const { autocomplete } = useGeocoding()
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoError, setGeoError] = useState('')
  const geoRequest = useRef<AbortController | null>(null)
  useEffect(() => () => geoRequest.current?.abort(), [])
  const locate = async () => {
    geoRequest.current?.abort()
    const controller = new AbortController()
    geoRequest.current = controller
    setGeoBusy(true)
    setGeoError('')
    try {
      const point = await requestLocation(controller.signal)
      const place = await reverseGeocode(point.latitude, point.longitude, controller.signal)
      if (controller.signal.aborted) return
      if (!place.city) throw new Error('Геопозиция найдена, но город определить не удалось. Выберите город из списка.')
      setCityPin({ name: place.city, latitude: point.latitude, longitude: point.longitude })
      back()
    } catch (error) {
      if (!controller.signal.aborted) setGeoError(error instanceof Error ? error.message : 'Не удалось определить город')
    } finally { if (!controller.signal.aborted) setGeoBusy(false) }
  }
  const [remoteCities, setRemoteCities] = useState<CityPin[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const currentSearchRevision = useRef(searchRevision)
  useLayoutEffect(() => {
    currentSearchRevision.current = searchRevision
  }, [searchRevision])

  useEffect(() => {
    const requestedRevision = searchRevision
    const value = query.trim()
    setSearchError('')
    setRemoteCities([])
    if (value.length < 2 || (!autocomplete && submittedQuery !== value)) {
      setSearching(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      if (currentSearchRevision.current !== requestedRevision) return
      const run = async () => {
        setSearching(true)
        try {
          const path = `/cities?q=${encodeURIComponent(value)}`
          let response: { cities: CityPin[] }
          try {
            response = await request<{ cities: CityPin[] }>(path, {
              signal: controller.signal,
            }, 46000)
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 429 || controller.signal.aborted)
              throw error
            await new Promise<void>((resolve) => window.setTimeout(resolve, 1100))
            if (controller.signal.aborted) return
            response = await request<{ cities: CityPin[] }>(path, {
              signal: controller.signal,
            }, 46000)
          }
          if (controller.signal.aborted || currentSearchRevision.current !== requestedRevision)
            return
          const normalized = Array.isArray(response.cities)
            ? response.cities.map(readCity).filter((value): value is CityPin => value !== null)
            : []
          setRemoteCities(normalized)
        } catch (error) {
          if (!controller.signal.aborted && currentSearchRevision.current === requestedRevision) {
            setRemoteCities([])
            setSearchError(
              error instanceof Error ? error.message : 'Онлайн-поиск городов временно недоступен',
            )
          }
        } finally {
          if (!controller.signal.aborted && currentSearchRevision.current === requestedRevision)
            setSearching(false)
        }
      }
      void run()
    }, 350)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, searchRevision, submittedQuery, autocomplete])

  const candidates = new Map<string, CityPin>()
  cityCatalog.forEach((value) => {
    candidates.set(cityKey(value), value)
  })
  if (cityPin) candidates.set(cityKey(cityPin), { ...cityPin, name: cityTitle(cityPin) })
  remoteCities.forEach((value) => {
    candidates.set(cityKey(value), value)
  })

  const queryKey = query.trim().toLocaleLowerCase('ru')
  const cities = [...candidates.values()]
    .filter((value) => !queryKey || value.name.toLocaleLowerCase('ru').includes(queryKey))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }))

  const noResults = cities.length === 0
  return (
    <>
      <Header title="Выбрать город" back={back} />
      <div className="screen-scroll">
        <div className="extra-pad">
          <form onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query.trim()); setSearchRevision((value) => value + 1) }}>
            <SearchField value={query} onChange={(value) => { setQuery(value); setSubmittedQuery('') }} placeholder="Найти город" />
            {!autocomplete && query.trim().length >= 2 && <button className="form-link" type="submit" disabled={searching}>{searching ? 'Ищем…' : 'Искать во всех городах'}</button>}
          </form>
        </div>
        {!queryKey && (
          <Cell
            icon="location"
            title={geoBusy ? "Определяем геолокацию…" : "Моя геолокация"}
            onClick={() => void locate()}
          />
        )}
        {geoError && <p className="extra-pad" role="alert">{geoError}</p>}
        {cities.map((value) => (
          <Cell
            key={`${cityKey(value)}:${value.latitude}:${value.longitude}`}
            icon="pin"
            title={value.name}
            trailing={
              cityKey(value) === cityKey(city) ? <Icon name="check" size={20} /> : undefined
            }
            onClick={() => {
              setCityPin(value)
              back()
            }}
          />
        ))}
        {searchError && noResults ? (
          <StatePanel
            title="Не удалось загрузить города"
            description={searchError}
            action="Повторить"
            onAction={() => { setSubmittedQuery(query.trim()); setSearchRevision((value) => value + 1) }}
          />
        ) : searching && noResults ? (
          <StatePanel title="" loading />
        ) : noResults ? (
          <StatePanel
            title={query.trim().length === 1 ? 'Введите ещё один символ' : 'Город не найден'}
            description={
              query.trim().length === 1
                ? 'Напиши хотя бы две буквы — так мы найдём город.'
                : undefined
            }
          />
        ) : null}
        {searchError && !noResults ? (
          <p className="extra-hint">
            Поиск сейчас не отвечает — показываем города, которые уже есть в приложении.
          </p>
        ) : null}
      </div>
    </>
  )
}
