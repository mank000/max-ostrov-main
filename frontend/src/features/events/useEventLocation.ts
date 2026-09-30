import { useGeocoding } from '../../useGeocoding'
import { cityCatalog } from '../../city-catalog'
import { requestLocation } from '../../location'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/http'
import { reverseGeocode, searchCities, searchPlaces, type CitySuggestion, type PlaceSuggestion } from '../../api/places'
import { eventAddressCandidates, matchEventCity } from '../../event-form'
import { validPoint } from '../../ui-utils'
import type { EventDraft, SetEventField } from './useEventDraft'

export function useEventLocation(draft: EventDraft, setField: SetEventField, step: number, setStep: (value: number) => void, setError: (value: string) => void) {
  const { eventCity, address, latitude, longitude } = draft
  const { autocomplete } = useGeocoding()
  const [resolvingAddress, setResolvingAddress] = useState(false)
  const [placeSearchBusy, setPlaceSearchBusy] = useState(false)
  const [cityOrigin, setCityOrigin] = useState<CitySuggestion | null>(null)
  const [addressChoices, setAddressChoices] = useState<PlaceSuggestion[]>([])
  const [resolvedAddress, setResolvedAddress] = useState('')
  const geoRequest = useRef<AbortController | null>(null)
  const geocodeGeneration = useRef(0)
  const citySearchGeneration = useRef(0)
  const placeSearchGeneration = useRef(0)
  useEffect(() => () => {
    geoRequest.current?.abort()
    ++geocodeGeneration.current
    ++citySearchGeneration.current
    ++placeSearchGeneration.current
  }, [])
  useEffect(() => {
    if (step !== 1) return
    const query = eventCity.trim()
    if (query.length < 2) {
      setCityOrigin(null)
      return
    }
    if (!autocomplete) {
      setCityOrigin(cityCatalog.find((city) => city.name.toLocaleLowerCase('ru') === query.toLocaleLowerCase('ru')) || null)
      return
    }
    const controller = new AbortController()
    const generation = ++citySearchGeneration.current
    const run = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const items = await searchCities(query, controller.signal)
          if (controller.signal.aborted || generation !== citySearchGeneration.current) return
          setCityOrigin(matchEventCity(items, query) || null)
          return
        } catch (cause) {
          if (controller.signal.aborted || generation !== citySearchGeneration.current) return
          if (cause instanceof ApiError && cause.status === 429 && attempt === 0) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 1050))
            continue
          }
          setCityOrigin(null)
          return
        }
      }
    }
    const timer = window.setTimeout(() => void run(), 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      if (generation === citySearchGeneration.current) ++citySearchGeneration.current
    }
  }, [step, eventCity, autocomplete])
  useEffect(() => {
    if (step !== 1) return
    const query = address.trim()
    if (!autocomplete || query.length < 2 || !cityOrigin || validPoint(latitude, longitude)) {
      setPlaceSearchBusy(false)
      setAddressChoices([])
      return
    }
    const controller = new AbortController()
    const generation = ++placeSearchGeneration.current
    const timer = window.setTimeout(() => {
      const run = async () => {
        if (generation !== placeSearchGeneration.current || controller.signal.aborted) return
        setPlaceSearchBusy(true)
        try {
          let places: PlaceSuggestion[] | undefined
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              places = await searchPlaces(
                query.slice(0, 80),
                cityOrigin.name,
                cityOrigin.latitude,
                cityOrigin.longitude,
                controller.signal,
              )
              break
            } catch (cause) {
              if (controller.signal.aborted || generation !== placeSearchGeneration.current) return
              if (cause instanceof ApiError && cause.status === 429 && attempt === 0) {
                await new Promise<void>((resolve) => window.setTimeout(resolve, 1050))
                continue
              }
              throw cause
            }
          }
          if (generation === placeSearchGeneration.current && !controller.signal.aborted)
            setAddressChoices((places || []).slice(0, 6))
        } catch {
          if (generation === placeSearchGeneration.current && !controller.signal.aborted)
            setAddressChoices([])
        } finally {
          if (generation === placeSearchGeneration.current && !controller.signal.aborted)
            setPlaceSearchBusy(false)
        }
      }
      void run()
    }, 650)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      if (generation === placeSearchGeneration.current) ++placeSearchGeneration.current
    }
  }, [step, address, cityOrigin, latitude, longitude, autocomplete])
  function changeAddress(value: string) {
    geoRequest.current?.abort()
    ++geocodeGeneration.current
    ++placeSearchGeneration.current
    setResolvingAddress(false)
    setPlaceSearchBusy(false)
    setField('address', value)
    setField('venue', '')
    setField('latitude', undefined)
    setField('longitude', undefined)
    setResolvedAddress('')
    setAddressChoices([])
    setError('')
  }
  function changeEventCity(value: string) {
    geoRequest.current?.abort()
    ++geocodeGeneration.current
    ++citySearchGeneration.current
    ++placeSearchGeneration.current
    setResolvingAddress(false)
    setPlaceSearchBusy(false)
    setField('eventCity', value)
    setField('venue', '')
    setCityOrigin(null)
    setField('latitude', undefined)
    setField('longitude', undefined)
    setResolvedAddress('')
    setAddressChoices([])
    setError('')
  }
  async function resolveTypedAddress() {
    if (validPoint(latitude, longitude)) return true
    geoRequest.current?.abort()
    const controller = new AbortController()
    geoRequest.current = controller
    const generation = ++geocodeGeneration.current
    setResolvingAddress(true)
    setAddressChoices([])
    async function retryWhenProviderBusy<T>(operation: () => Promise<T>): Promise<T | undefined> {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (controller.signal.aborted || generation !== geocodeGeneration.current) return undefined
        try {
          return await operation()
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 429 || attempt === 2) throw cause
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1150))
        }
      }
      return undefined
    }
    try {
      const cities = await retryWhenProviderBusy(() => searchCities(eventCity.trim(), controller.signal))
      if (!cities || generation !== geocodeGeneration.current) return false
      const city = matchEventCity(cities, eventCity)
      if (!city) {
        setError('Город не найден. Проверьте его название.')
        return false
      }
      const places = await retryWhenProviderBusy(() =>
        searchPlaces(address.trim().slice(0, 80), city.name, city.latitude, city.longitude, controller.signal),
      )
      if (!places || generation !== geocodeGeneration.current) return false
      const candidates = eventAddressCandidates(places, city.name)
      if (!candidates.length) {
        setError('Адрес не найден. Уточните его или выберите точку на карте.')
        return false
      }
      if (candidates.length > 1) {
        setAddressChoices(candidates.slice(0, 5))
        setError('Выберите подходящий адрес из списка ниже.')
        return false
      }
      const place = candidates[0]
      setField('latitude', place.latitude)
      setField('longitude', place.longitude)
      setResolvedAddress([place.title, place.subtitle].filter(Boolean).join(' · '))
      return true
    } catch {
      if (generation === geocodeGeneration.current)
        setError('Не удалось найти адрес. Попробуйте ещё раз или выберите точку на карте.')
      return false
    } finally {
      if (generation === geocodeGeneration.current) setResolvingAddress(false)
    }
  }
  function chooseAddress(place: PlaceSuggestion) {
    geoRequest.current?.abort()
    ++geocodeGeneration.current
    ++placeSearchGeneration.current
    const normalizedAddress = (place.subtitle || place.title).trim().slice(0, 240)
    setResolvingAddress(false)
    setPlaceSearchBusy(false)
    setField('latitude', place.latitude)
    setField('longitude', place.longitude)
    setField('venue', place.title.trim().slice(0, 160))
    setField('address', normalizedAddress)
    if (place.city.trim()) setField('eventCity', place.city.trim())
    setResolvedAddress(normalizedAddress || place.title)
    setAddressChoices([])
    setError('')
  }
  function openLocationPicker() {
    geoRequest.current?.abort()
    ++geocodeGeneration.current
    setResolvingAddress(false)
    setAddressChoices([])
    setStep(10)
  }
  async function fillFromCurrentLocation() {
    geoRequest.current?.abort()
    const controller = new AbortController()
    geoRequest.current = controller
    const generation = ++geocodeGeneration.current
    setResolvingAddress(true)
    setError('')
    try {
      const position = await requestLocation(controller.signal)
      if (controller.signal.aborted || generation !== geocodeGeneration.current) return
      setField('latitude', position.latitude)
      setField('longitude', position.longitude)
      setField('address', '')
      setAddressChoices([])
      setResolvedAddress('')
      setField('venue', (current) => current || 'Точка на карте')
      try {
        const place = await reverseGeocode(position.latitude, position.longitude, controller.signal)
        if (controller.signal.aborted || generation !== geocodeGeneration.current) return
        setField('venue', (current) => current === 'Точка на карте' && place.venue_name ? place.venue_name : current)
        setField('address', place.address)
        setField('eventCity', place.city || eventCity)
        setResolvedAddress(place.address)
      } catch (cause) {
        if (!controller.signal.aborted && generation === geocodeGeneration.current)
          setError('Геопозиция найдена. Не удалось определить адрес — укажите его вручную.')
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation === geocodeGeneration.current)
        setError(cause instanceof Error ? cause.message : 'Не удалось получить геопозицию')
    } finally {
      if (generation === geocodeGeneration.current) setResolvingAddress(false)
    }
  }
  async function selectPoint(lat: number, lng: number) {
    if (!validPoint(lat, lng)) return
    geoRequest.current?.abort()
    const controller = new AbortController()
    geoRequest.current = controller
    const generation = ++geocodeGeneration.current
    setResolvingAddress(true)
    setField('latitude', lat)
    setField('longitude', lng)
    setField('address', '')
    setAddressChoices([])
    setResolvedAddress('')
    setField('venue', (current) => current || 'Точка на карте')
    setError('')
    try {
      const place = await reverseGeocode(lat, lng, controller.signal)
      if (generation !== geocodeGeneration.current) return
      setField('venue', (current) =>
        current === 'Точка на карте' && place.venue_name ? place.venue_name : current,
      )
      setField('address', place.address)
      setField('eventCity', place.city || eventCity)
      setResolvedAddress(place.address)
    } catch {
      if (generation === geocodeGeneration.current)
        setError('Точка выбрана. Уточните адрес встречи вручную.')
    }
    if (!controller.signal.aborted && generation === geocodeGeneration.current) {
      setResolvingAddress(false)
      setStep(1)
    }
  }
  return {
    autocomplete,
    resolvingAddress,
    placeSearchBusy,
    addressChoices,
    resolvedAddress,
    changeAddress,
    changeEventCity,
    resolveTypedAddress,
    chooseAddress,
    openLocationPicker,
    fillFromCurrentLocation,
    selectPoint,
  }
}
