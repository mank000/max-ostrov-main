import { useCallback, useState, type SetStateAction } from 'react'

export type EventDraft = {
  title: string
  description: string
  category: string
  start: string
  end: string
  venue: string
  address: string
  eventCity: string
  latitude?: number
  longitude?: number
  price: string
  ticketUrl: string
}
export type SetEventField = <K extends keyof EventDraft>(key: K, value: SetStateAction<EventDraft[K]>) => void

export function useEventDraft(city: string) {
  const [draft, setDraft] = useState<EventDraft>(() => ({
    title: '',
    description: '',
    category: '',
    start: '',
    end: '',
    venue: '',
    address: '',
    eventCity: city,
    price: '',
    ticketUrl: '',
  }))
  const setField: SetEventField = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: typeof value === 'function' ? value(current[key]) : value }))
  }, [])
  return [draft, setField] as const
}
