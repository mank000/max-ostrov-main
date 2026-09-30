import { useCallback, useEffect, useState } from 'react'

export type Modal = {
  title: string
  description?: string
  cancel?: string
  confirm: string
  onConfirm: () => void
  destructive?: boolean
}

export function useFeedback() {
  const [modal, setModal] = useState<Modal | null>(null)
  const [toast, setToast] = useState('')
  const showError = useCallback(
    (description: string) =>
      setModal({
        title: 'Не удалось выполнить действие',
        description,
        confirm: 'Понятно',
        onConfirm: () => setModal(null),
      }),
    [],
  )
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  return { modal, setModal, toast, setToast, showError }
}
