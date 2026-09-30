import { useEffect, useState } from 'react'
import { loadStoreItems, type StoreItem } from '../../api/rewards'

export function useStore(onError: (message: string) => void) {
  const [items, setItems] = useState<StoreItem[]>([])
  useEffect(() => {
    const controller = new AbortController()
    loadStoreItems(controller.signal)
      .then(setItems)
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    return () => controller.abort()
  }, [onError])
  return items
}
