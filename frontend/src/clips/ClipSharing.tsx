import { useEffect, useState } from 'react'
import { loadAllFriends, type Friend } from '../api/users'
import { shareClip } from '../api/clips'
import { Avatar, Icon } from '../ui/components/BasicUI'
import type { HostAdapter } from '../host'
import { Sheet as ClipSheet } from '../ui/components/Sheet'

export function ClipSharing({
  clipId,
  host,
  onClose,
}: {
  clipId: number
  host: HostAdapter
  onClose: () => void
}) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sent, setSent] = useState<number[]>([])
  const [busy, setBusy] = useState<number[]>([])
  const [menu, setMenu] = useState<number | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError('')
    loadAllFriends(abort.signal)
      .then((items) => { if (!abort.signal.aborted) setFriends(items) })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить друзей')
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [retry])
  async function send(id: number) {
    setBusy((items) => [...items, id])
    setError('')
    try {
      await shareClip(clipId, id)
      setSent((items) => [...items, id])
      host.hapticSelection()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить')
    } finally {
      setBusy((items) => items.filter((value) => value !== id))
    }
  }
  const filtered = friends.filter(({ user }) =>
    `${user.display_name} ${user.username || ''}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  )
  return (
    <ClipSheet title="Отправить другу" onClose={onClose}>
      <p className="clip-sheet-hint">
        Видео появится у друга во вкладке «Прислано».
      </p>
      <input
        className="clip-search"
        aria-label="Найти друга"
        placeholder="Найти друга"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {loading && <p role="status">Загружаем друзей…</p>}
      {!loading && !filtered.length && (
        <p>
          {friends.length
            ? 'Никого не нашли'
            : 'Здесь появятся ваши друзья из общего профиля.'}
        </p>
      )}
      {filtered.map(({ user }) => (
        <div key={user.id} className="clip-friend-wrap">
          <div className="clip-friend">
            <Avatar name={user.display_name} url={user.photo_url} size={42} />
            <strong>{user.display_name}</strong>
            <button
              className="clip-send-button"
              disabled={busy.includes(user.id) || sent.includes(user.id)}
              onClick={() => void send(user.id)}
            >
              {sent.includes(user.id)
                ? 'Отправлено'
                : busy.includes(user.id)
                  ? '…'
                  : 'Отправить'}
            </button>
            <button
              aria-label={`Действия: ${user.display_name}`}
              onClick={() => setMenu(menu === user.id ? null : user.id)}
            >
              <Icon name="more" />
            </button>
          </div>
          {menu === user.id && (
            <button
              className="clip-menu-item"
              disabled={!user.max_chat_id}
              onClick={() => {
                if (user.max_chat_id && !host.openChat(user.max_chat_id))
                  setError('Не удалось открыть MAX')
              }}
            >
              Написать в MAX{!user.max_chat_id ? ' · недоступно' : ''}
            </button>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="clip-error">
          {error}
          <button onClick={() => setRetry(retry + 1)}>Повторить</button>
        </p>
      )}
    </ClipSheet>
  )
}
