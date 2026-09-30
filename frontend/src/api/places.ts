import { ApiError, collection, request } from './http'

type ReverseLocation = {
  venue_name: string
  address: string
  city: string
}

export type CitySuggestion = {
  name: string
  latitude: number
  longitude: number
}

export type PlaceSuggestion = {
  title: string
  subtitle: string
  city: string
  region: string
  latitude: number
  longitude: number
  scope: 'city' | 'region'
  category?: string
}

export async function searchCities(query: string, signal?: AbortSignal) {
  const value = query.trim()
  if (value.length < 2 || value.length > 80)
    throw new ApiError('Введите от 2 до 80 символов для поиска города', 400)
  return collection(
    (
      await request<{ cities: CitySuggestion[] }>(`/cities?q=${encodeURIComponent(value)}`, {
        signal,
      }, 46000)
    ).cities,
  )
}

export async function searchPlaces(
  query: string,
  city: string,
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
) {
  const value = query.trim()
  const cityName = city.trim()
  if (value.length < 2 || value.length > 80)
    throw new ApiError('Введите от 2 до 80 символов для поиска места', 400)
  if (
    !cityName ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  ) {
    throw new ApiError('Сначала выберите город', 400)
  }
  const params = new URLSearchParams({
    q: value,
    city: cityName,
    latitude: String(latitude),
    longitude: String(longitude),
  })
  return collection(
    (
      await request<{ places: PlaceSuggestion[] }>(`/places/search?${params}`, {
        signal,
      }, 46000)
    ).places,
  )
}

export async function reverseGeocode(latitude: number, longitude: number, signal?: AbortSignal) {
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  ) {
    throw new ApiError('Некорректная точка на карте', 400)
  }
  const path = `/locations/reverse?latitude=${encodeURIComponent(String(latitude))}&longitude=${encodeURIComponent(String(longitude))}`
  const body = await request<{ location: ReverseLocation }>(path, { signal }, 46000)
  if (
    !body.location ||
    typeof body.location.venue_name !== 'string' ||
    typeof body.location.address !== 'string' ||
    typeof body.location.city !== 'string'
  ) {
    throw new ApiError('Сервер вернул некорректные данные места', 502)
  }
  return body.location
}
