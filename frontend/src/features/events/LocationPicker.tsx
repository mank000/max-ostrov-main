import { useEffect, useRef, useState } from 'react'
import { embeddedMapURL, validPoint } from '../../ui-utils'
import { Button, Cell, Header } from '../../ui/components/BasicUI'

export function LocationPicker({
  latitude,
  longitude,
  onCancel,
  onSelect,
}: {
  latitude?: number
  longitude?: number
  onCancel: () => void
  onSelect: (latitude: number, longitude: number) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [point, setPoint] = useState<{
    latitude: number
    longitude: number
  } | null>(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : null)
  const pointRef = useRef(point)
  pointRef.current = point
  useEffect(() => {
    const receive = (
      message: MessageEvent<{
        type?: string
        latitude?: number
        longitude?: number
      }>,
    ) => {
      if (
        message.origin !== window.location.origin ||
        message.source !== frame.current?.contentWindow
      )
        return
      if (!message.data || typeof message.data !== 'object') return
      if (message.data.type === 'kutezh:map-ready')
        frame.current?.contentWindow?.postMessage(
          { type: 'kutezh:picker', enabled: true, point: pointRef.current },
          window.location.origin,
        )
      if (
        message.data.type === 'kutezh:point-select' &&
        typeof message.data.latitude === 'number' &&
        typeof message.data.longitude === 'number' &&
        validPoint(message.data.latitude, message.data.longitude)
      ) {
        setPoint({
          latitude: message.data.latitude,
          longitude: message.data.longitude,
        })
      }
    }
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener('message', receive)
      frame.current?.contentWindow?.postMessage(
        { type: 'kutezh:picker', enabled: false },
        window.location.origin,
      )
    }
  }, [])
  return (
    <>
      <Header title="Точка на карте" back={onCancel} />
      <div className="screen-scroll">
        <div className="location-picker-map">
          <iframe
            ref={frame}
            src={embeddedMapURL(import.meta.env.VITE_MAP_URL)}
            title="Выбор места на карте"
            onLoad={() =>
              frame.current?.contentWindow?.postMessage(
                { type: 'kutezh:parent-ready' },
                window.location.origin,
              )
            }
          />
        </div>
        <div className="extra-pad">
          <p className="extra-body">Нажмите на карту, чтобы поставить точку встречи.</p>
        </div>
        {point && (
          <Cell
            icon="pin"
            title="Выбранная точка"
            detail={`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`}
            onClick={() => { }}
          />
        )}
      </div>
      <div className="bottom-action">
        <Button
          disabled={!point}
          onClick={() => point && onSelect(point.latitude, point.longitude)}
        >
          Выбрать точку
        </Button>
      </div>
    </>
  )
}

