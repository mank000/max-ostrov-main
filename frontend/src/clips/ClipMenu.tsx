import { useEffect, useState } from 'react'
import { loadFriendDirectMessageTarget, setBlocked } from '../api/users'
import { deletePost } from '../api/posts'
import { clipFeedback, type Clip } from '../api/clips'
import { reportContent } from '../api/reports'
import type { HostAdapter } from '../host'
import { Sheet as ClipSheet } from '../ui/components/Sheet'

const playbackRates = [0.5, 1, 1.5, 2] as const

export function ClipMenu({
  clip,
  self,
  host,
  playbackRate,
  onPlaybackRate,
  onClose,
  onRemove,
}: {
  clip: Clip
  self: boolean
  host: HostAdapter
  playbackRate: number
  onPlaybackRate: (rate: number) => void
  onClose: () => void
  onRemove: (author?: boolean) => void
}) {
  const [chat, setChat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'block' | 'report' | null>(
    null,
  )
  useEffect(() => {
    const abort = new AbortController()
    if (!self)
      void loadFriendDirectMessageTarget(clip.author.id, abort.signal)
        .then((target) => setChat(target.max_chat_id || ''))
        .catch(() => {})
    return () => abort.abort()
  }, [clip.author.id, self])
  async function run(
    action: () => Promise<void>,
    remove = false,
    author = false,
  ) {
    setBusy(true)
    setError('')
    try {
      await action()
      if (remove) onRemove(author)
      else onClose()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось выполнить действие',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <ClipSheet
      title={
        confirm === 'delete'
          ? 'Удалить видео?'
          : confirm === 'block'
            ? 'Заблокировать автора?'
            : confirm === 'report'
              ? 'Причина жалобы'
              : 'Видео'
      }
      onClose={onClose}
    >
      <div className="clip-menu">
        {!confirm && (
          <>
            <div className="clip-speed-menu">
              <span>Скорость воспроизведения</span>
              <div
                className="clip-speed-options"
                role="radiogroup"
                aria-label="Скорость воспроизведения"
              >
                {playbackRates.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={playbackRate === value}
                    className={playbackRate === value ? 'is-active' : ''}
                    onClick={() => {
                      onPlaybackRate(value)
                      host.hapticSelection()
                    }}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>
            <small>
              Удерживайте левый или правый край ролика для временной скорости 2×.
            </small>
            {!self && (
              <>
                <button
                  disabled={!chat}
                  onClick={() => {
                    if (!host.openChat(chat)) setError('Не удалось открыть MAX')
                  }}
                >
                  Написать в MAX
                </button>
                {!chat && (
                  <small>Переписка доступна друзьям с аккаунтом MAX.</small>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => clipFeedback(clip.id, 0, true), true)
                  }
                >
                  Не интересно
                </button>
                <button onClick={() => setConfirm('report')}>
                  Пожаловаться
                </button>
                <button onClick={() => setConfirm('block')}>
                  Заблокировать автора
                </button>
              </>
            )}
            {self && (
              <button
                className="clip-danger"
                onClick={() => setConfirm('delete')}
              >
                Удалить видео
              </button>
            )}
          </>
        )}
        {confirm === 'delete' && (
          <>
            <p>Видео исчезнет из ленты, профиля и присланных друзьям.</p>
            <button
              disabled={busy}
              className="clip-danger"
              onClick={() => void run(() => deletePost(clip.id), true)}
            >
              Удалить
            </button>
          </>
        )}
        {confirm === 'block' && (
          <>
            <p>
              Видео автора будут скрыты. Используется общая блокировка профиля.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void run(() => setBlocked(clip.author.id, true), true, true)
              }
            >
              Заблокировать
            </button>
          </>
        )}
        {confirm === 'report' &&
          [
            'Спам или обман',
            'Оскорбления или травля',
            'Опасный или недопустимый контент',
            'Нарушение прав',
          ].map((reason) => (
            <button
              key={reason}
              disabled={busy}
              onClick={() =>
                void run(() => reportContent('post', clip.id, reason))
              }
            >
              {reason}
            </button>
          ))}
        {confirm && <button onClick={() => setConfirm(null)}>Назад</button>}
      </div>
      {error && (
        <p role="alert" className="clip-error">
          {error}
        </p>
      )}
    </ClipSheet>
  )
}
