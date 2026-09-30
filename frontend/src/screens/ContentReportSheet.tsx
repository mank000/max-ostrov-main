import { useState, type FormEvent } from 'react'
import { reportContent } from '../api/reports'
import { Button, Field } from '../ui/components/BasicUI'
import { useExpandableSheet } from '../ui/components/useExpandableSheet'
import './comment-experience.css'
import './details.css'

export function ContentReportSheet({
  targetType,
  targetId,
  title,
  preview,
  onClose,
  onSent,
}: {
  targetType: 'comment' | 'event'
  targetId: number
  title: string
  preview: string
  onClose: () => void
  onSent: () => void
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { sheetRef, handleProps, expanded } = useExpandableSheet<HTMLFormElement>({
    onClose: () => {
      if (!saving) onClose()
    },
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = reason.trim()
    if (text.length < 3 || saving) return
    setSaving(true)
    setError('')
    try {
      await reportContent(targetType, targetId, text)
      onSent()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить жалобу')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="comment-report-backdrop" role="presentation">
      <button
        className="sheet-backdrop-dismiss"
        type="button"
        tabIndex={-1}
        aria-label="Закрыть жалобу"
        onClick={() => {
          if (!saving) onClose()
        }}
      />
      <form
        ref={sheetRef}
        className="comment-report-sheet"
        data-sheet-expanded={expanded}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={submit}
      >
        <button {...handleProps} />
        <h3>{title}</h3>
        <p>{preview}</p>
        <Field
          label="Причина жалобы"
          value={reason}
          onChange={(value) => setReason(value.slice(0, 360))}
          placeholder="Опишите, что не так"
          multiline
        />
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="comment-report-sheet__actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={reason.trim().length < 3 || saving}>
            {saving ? 'Отправляем…' : 'Отправить'}
          </Button>
        </div>
      </form>
    </div>
  )
}
