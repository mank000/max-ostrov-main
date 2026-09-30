import { useEffect, useMemo, useState } from 'react'
import { preparePhotoFile } from '../../api/media'

type EventArtworkDraft = { source: File; crop: File }
type EventArtworkCropTarget = { kind: 'header' | 'icon'; file: File }

export function useEventArtwork(busy: boolean, setError: (value: string) => void) {
  const [headerArtwork, setHeaderArtwork] = useState<EventArtworkDraft | null>(null)
  const [iconArtwork, setIconArtwork] = useState<EventArtworkDraft | null>(null)
  const [artworkCrop, setArtworkCrop] = useState<EventArtworkCropTarget | null>(null)
  const [preparingArtwork, setPreparingArtwork] = useState(false)
  const headerPreview = useMemo(
    () => (headerArtwork ? URL.createObjectURL(headerArtwork.crop) : ''),
    [headerArtwork],
  )
  const iconPreview = useMemo(
    () => (iconArtwork ? URL.createObjectURL(iconArtwork.crop) : ''),
    [iconArtwork],
  )
  useEffect(
    () => () => {
      if (headerPreview) URL.revokeObjectURL(headerPreview)
    },
    [headerPreview],
  )
  useEffect(
    () => () => {
      if (iconPreview) URL.revokeObjectURL(iconPreview)
    },
    [iconPreview],
  )
  async function chooseArtwork(kind: 'header' | 'icon', file?: File) {
    if (!file || preparingArtwork || busy) return
    setPreparingArtwork(true)
    setError('')
    try {
      const prepared = await preparePhotoFile(file)
      setArtworkCrop({ kind, file: prepared })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подготовить изображение')
    } finally {
      setPreparingArtwork(false)
    }
  }
  async function confirmArtworkCrop(crop: File) {
    const target = artworkCrop
    if (!target) return
    const draft = { source: target.file, crop }
    if (target.kind === 'header') setHeaderArtwork(draft)
    else setIconArtwork(draft)
    setArtworkCrop(null)
  }
  function removeArtwork(kind: 'header' | 'icon') {
    if (kind === 'header') setHeaderArtwork(null)
    else setIconArtwork(null)
  }
  return {
    headerArtwork,
    iconArtwork,
    artworkCrop,
    setArtworkCrop,
    preparingArtwork,
    headerPreview,
    iconPreview,
    chooseArtwork,
    confirmArtworkCrop,
    removeArtwork,
  }
}
