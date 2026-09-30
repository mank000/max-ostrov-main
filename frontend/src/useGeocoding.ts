import { useEffect, useState } from 'react'
import { request } from './api/http'

let settings: Promise<boolean> | null = null

export function useGeocoding() {
  const [autocomplete, setAutocomplete] = useState(false)
  useEffect(() => {
    let active = true
    settings ??= request<{ autocomplete: boolean }>('/geocoding/config')
      .then((value) => value.autocomplete === true)
      .catch(() => { settings = null; return false })
    settings.then((value) => { if (active) setAutocomplete(value) })
    return () => { active = false }
  }, [])
  return { autocomplete }
}
