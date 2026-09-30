import { dismissTopDialog } from '../ui/dialogs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadClip, loadClips, type Clip, type ClipScope } from '../api/clips'
import { setPostLike } from '../api/posts'
import { ApiError } from '../api/http'
import { setFollowing, type Profile } from '../api/users'
import type { HostAdapter } from '../host'
import { Icon } from '../ui/components/BasicUI'
import { Camera } from './Camera'
import { ClipEditor } from './ClipEditor'
import { ClipPlayer } from './ClipPlayer'
import { ClipSharing } from './ClipSharing'
import { ClipProfile } from './ClipProfile'
import { ClipMenu } from './ClipMenu'
import { ClipComments } from './ClipComments'
import { ClipInbox } from './ClipInbox'
import { Sheet as ClipSheet } from '../ui/components/Sheet'
import './clips.css'
import { watchPosts, syncPosts } from '../data/postSync'
import { useDeviceLayout } from '../app/useDeviceLayout'

type Overlay =
  | { kind: 'create' }
  | { kind: 'camera' }
  | { kind: 'share'; clip: Clip }
  | { kind: 'comments'; clip: Clip }
  | { kind: 'profile'; id: number }
  | { kind: 'menu'; clip: Clip }
  | { kind: 'editor'; file: File }
  | null
export default function ClipsScreen({
  profile,
  host,
  onBack,
  initialClipId,
  initialOpenComments,
  unreadInbox,
  onInboxRead,
}: {
  profile: Profile
  host: HostAdapter
  onBack: () => void
  initialClipId?: number
  initialOpenComments?: boolean
  unreadInbox: number
  onInboxRead: () => void
}) {
  const desktop = useDeviceLayout()
  const [scope, setScope] = useState<ClipScope>('for-you')
  const [directClip, setDirectClip] = useState<{ id: number; comments: boolean } | null>(() =>
    initialClipId ? { id: initialClipId, comments: Boolean(initialOpenComments) } : null,
  )
  const [author, setAuthor] = useState({ id: 0, name: '', clipID: 0 })
  const [clips, setClips] = useState<Clip[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [active, setActive] = useState(0)
  const [muted, setMuted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState<number[]>([])
  const pending = useRef(new Set<string>())
  const editorBack = useRef<(() => void) | null>(null)
  const inboxBack = useRef<(() => boolean) | null>(null)
  const feed = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const paging = useRef(false)
  const [toast, setToast] = useState('')
  const [inboxUnread, setInboxUnread] = useState(unreadInbox)
  const [inboxViewer, setInboxViewer] = useState<{
    peerId: number
    peerName: string
    startIndex: number
  } | null>(null)
  const [playbackRate, setPlaybackRate] = useState(1)
  const closeOverlay = useCallback(() => setOverlay(null), [])
  const closeInboxViewer = useCallback(() => {
    setInboxViewer(null)
    setClips([])
    setCursor(undefined)
    setActive(0)
  }, [])
  const commentsOpen = overlay?.kind === 'comments'
  useEffect(() => {
    if (initialClipId)
      setDirectClip({ id: initialClipId, comments: Boolean(initialOpenComments) })
  }, [initialClipId, initialOpenComments])
  useEffect(() => {
    if (!inboxViewer) return
    const frame = requestAnimationFrame(() => {
      const el = feed.current
      if (!el?.clientHeight) return
      el.scrollTo({ top: inboxViewer.startIndex * el.clientHeight })
    })
    return () => cancelAnimationFrame(frame)
  }, [inboxViewer?.peerId, inboxViewer?.startIndex])
  useEffect(() => setInboxUnread(unreadInbox), [unreadInbox])
  useEffect(() => {
    const abort = new AbortController()
    const version = ++generation.current
    setLoading(true)
    setError('')
    setClips([])
    setCursor(undefined)
    setActive(0)
    paging.current = false
    feed.current?.scrollTo({ top: 0 })
    if (scope === 'inbox' && !directClip) {
      setLoading(false)
      return () => abort.abort()
    }
    const request = directClip
      ? loadClip(directClip.id, abort.signal).then(async (clip) => {
          try {
            const page = await loadClips('for-you', '', 0, abort.signal)
            return {
              clips: [clip, ...page.clips.filter((item) => item.id !== clip.id)],
              next_cursor: page.next_cursor,
            }
          } catch (cause) {
            if (abort.signal.aborted) throw cause
            return { clips: [clip], next_cursor: undefined }
          }
        })
      : loadClips(scope, '', author.id, abort.signal)
    request
      .then((page) => {
        if (version === generation.current) {
          setClips(page.clips)
          setCursor(page.next_cursor)
          if (directClip?.comments && page.clips[0]?.id === directClip.id)
            setOverlay({ kind: 'comments', clip: page.clips[0] })
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [scope, author.id, author.clipID, directClip?.id, directClip?.comments, retry, profile.hide_sensitive_language, profile.age])
  useEffect(() => {
    if (!loading && author.clipID) {
      const index = clips.findIndex((clip) => clip.id === author.clipID)
      if (index >= 0) {
        setActive(index)
        feed.current?.scrollTo({ top: index * feed.current.clientHeight })
      }
    }
  }, [loading, author.clipID])
  const watchedKey = clips
    .slice(Math.max(0, active - 1), active + 2)
    .map((clip) => clip.id)
    .join(',')
  useEffect(() => {
    setActive((value) => Math.min(value, Math.max(0, clips.length - 1)))
  }, [clips.length])
  useEffect(() => {
    if (!watchedKey) return
    return watchPosts(watchedKey.split(',').map(Number), (batch) =>
      setClips((items) =>
        items.flatMap((clip) => {
          if (!batch.requested.has(clip.id)) return [clip]
          const post = batch.posts.get(clip.id)
          return post ? [{ ...clip, ...post }] : []
        }),
      ),
    )
  }, [watchedKey])
  useEffect(() => {
    const incoming = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          shared?: boolean
          reacted?: boolean
          deleted?: boolean
        }>
      ).detail || {}
      if (!detail.shared && !detail.reacted && !detail.deleted) return
      if (detail.deleted) {
        if (scope === 'inbox') setToast('Сообщение с видео удалено')
        return
      }
      if (scope !== 'inbox') {
        setInboxUnread((value) => value + 1)
        setToast(
          detail.reacted
            ? 'На присланное ответили реакцией'
            : 'В присланных появились новые видео',
        )
        return
      }
      setToast(
        detail.reacted
          ? 'В диалоге появилась новая реакция'
          : 'Присланные видео обновлены',
      )
    }
    window.addEventListener('kutezh:clips-updated', incoming)
    return () => window.removeEventListener('kutezh:clips-updated', incoming)
  }, [scope])
  const loadMore = useCallback(async () => {
    if (!cursor || paging.current) return
    paging.current = true
    const version = generation.current
    try {
      const page = await loadClips(scope, cursor, author.id).catch((err) => {
        // A long viewing session may outlive its snapshot; resume without discarding the current video.
        if (err instanceof ApiError && err.status === 400)
          return loadClips(scope, '', author.id)
        throw err
      })
      if (version === generation.current) {
        setClips((items) => {
          const ids = new Set(items.map((item) => item.id))
          return [...items, ...page.clips.filter((item) => !ids.has(item.id))]
        })
        setCursor(page.next_cursor)
      }
    } catch (err) {
      if (version === generation.current)
        setError(
          err instanceof Error ? err.message : 'Не удалось загрузить видео',
        )
    } finally {
      if (version === generation.current) paging.current = false
    }
  }, [cursor, scope, author.id])
  useEffect(() => {
    if (!error && !loading && active >= clips.length - 3) void loadMore()
  }, [active, clips.length, loadMore, error, loading])
  useEffect(() => {
    const back = () => {
      if (dismissTopDialog()) return
      if (overlay?.kind === 'editor') {
        editorBack.current?.()
        return
      }
      if (overlay) {
        setOverlay(null)
        return
      }
      if (scope === 'inbox' && inboxViewer) {
        closeInboxViewer()
        return
      }
      if (scope === 'inbox' && inboxBack.current?.()) return
      if (scope === 'author') {
        setScope('for-you')
        setAuthor({ id: 0, name: '', clipID: 0 })
      } else onBack()
    }
    host.backButton?.show()
    host.backButton?.onClick(back)
    return () => host.backButton?.offClick(back)
  }, [host, overlay, scope, onBack, inboxViewer, closeInboxViewer])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timer)
  }, [toast])
  function select(next: ClipScope) {
    setOverlay(null)
    setInboxViewer(null)
    setDirectClip(null)
    setAuthor({ id: 0, name: '', clipID: 0 })
    setScope(next)
  }
  async function mutate(clip: Clip, kind: 'like' | 'follow') {
    const key = `${kind}:${kind === 'follow' ? clip.author.id : clip.id}`
    if (pending.current.has(key)) return
    pending.current.add(key)
    setBusy((items) => [...items, clip.id])
    setError('')
    const next = kind === 'like' ? !clip.liked_by_me : !clip.following
    try {
      if (kind === 'like') await setPostLike(clip.id, next)
      else await setFollowing(clip.author.id, next)
      setClips((items) =>
        items.map((item) =>
          kind === 'like' && item.id === clip.id
            ? {
                ...item,
                liked_by_me: next,
                like_count: Math.max(
                  0,
                  item.like_count +
                    (item.liked_by_me === next ? 0 : next ? 1 : -1),
                ),
              }
            : kind === 'follow' && item.author.id === clip.author.id
              ? { ...item, following: next }
              : item,
        ),
      )
      if (kind === 'like') syncPosts([clip.id])
      host.hapticSelection()
    } catch (err) {
      setToast(
        err instanceof Error ? err.message : 'Не удалось сохранить действие',
      )
    } finally {
      pending.current.delete(key)
      setBusy((items) => items.filter((id) => id !== clip.id))
    }
  }
  function remove(clip: Clip, all = false) {
    setClips((items) =>
      items.filter((item) =>
        all ? item.author.id !== clip.author.id : item.id !== clip.id,
      ),
    )
    setOverlay(null)
    setActive((value) => Math.min(value, Math.max(0, clips.length - 2)))
  }
  function openAuthor(id: number, name: string, clipID = 0) {
    setOverlay(null)
    setInboxViewer(null)
    setDirectClip(null)
    setAuthor({ id, name, clipID })
    setScope('author')
  }
  return (
    <main className={`clips-screen${scope === 'inbox' && !inboxViewer ? ' is-inbox' : ''}${desktop && commentsOpen ? ' has-comments' : ''}`} aria-label="Видео">
      <header className="clips-header">
        <button
          onClick={() => {
            if (scope === 'inbox' && inboxViewer) {
              closeInboxViewer()
              return
            }
            if (scope === 'inbox' && inboxBack.current?.()) return
            onBack()
          }}
          aria-label="К разделам"
        >
          <Icon name="back" />
        </button>
        {scope === 'author' ? (
          <button
            className="clip-author-title"
            onClick={() => select('for-you')}
          >
            {author.name} · Все видео
          </button>
        ) : scope === 'inbox' && inboxViewer ? (
          <span className="clip-inbox-feed-title">
            {inboxViewer.peerName} · Видео
          </span>
        ) : (
          <nav aria-label="Лента видео">
            {(
              [
                ['for-you', 'Для вас'],
                ['following', 'Подписки'],
                ['inbox', 'Прислано'],
              ] as const
            ).map(([id, title]) => (
              <button
                key={id}
                aria-current={scope === id ? 'page' : undefined}
                onClick={() => select(id)}
              >
                <span>{title}</span>
                {id === 'inbox' && inboxUnread > 0 && (
                  <span className="clip-tab-badge" aria-label={`${inboxUnread} новых присланных видео`}>
                    {inboxUnread > 99 ? '99+' : inboxUnread}
                  </span>
                )}
              </button>
            ))}
          </nav>
        )}
        <div className="clips-header-actions">
          <button
            onClick={() => setOverlay({ kind: 'create' })}
            aria-label="Создать видео"
          >
            <Icon name="plus" size={21} />
          </button>
          <button
            onClick={() => setOverlay({ kind: 'profile', id: profile.id })}
            aria-label="Мой профиль видео"
          >
            <Icon name="user" size={21} />
          </button>
        </div>
      </header>
      {scope === 'inbox' && (
        <div
          className="clip-inbox-preserve"
          hidden={Boolean(inboxViewer)}
          aria-hidden={Boolean(inboxViewer)}
        >
          <ClipInbox
            profileId={profile.id}
            host={host}
            desktop={desktop}
            backRequest={inboxBack}
            onRead={onInboxRead}
            onNotice={setToast}
            onForward={(clip) => setOverlay({ kind: 'share', clip })}
            onOpenVideo={(threadClips, index, peer) => {
              setOverlay(null)
              setError('')
              setLoading(false)
              setCursor(undefined)
              setClips(threadClips)
              setActive(index)
              setInboxViewer({
                peerId: peer.id,
                peerName: peer.display_name,
                startIndex: index,
              })
            }}
          />
        </div>
      )}
      {(scope !== 'inbox' || inboxViewer) && (
      <div
        className="clips-feed"
        ref={feed}
        tabIndex={0}
        aria-label="Вертикальная лента видео"
        onScroll={() => {
          const el = feed.current
          if (el?.clientHeight)
            setActive(Math.round(el.scrollTop / el.clientHeight))
        }}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !['ArrowUp', 'ArrowDown'].includes(event.key)
          )
            return
          event.preventDefault()
          feed.current?.scrollBy({
            top:
              (event.key === 'ArrowDown' ? 1 : -1) *
              (feed.current?.clientHeight || 0),
            behavior: 'smooth',
          })
        }}
      >
        {clips.map((clip, index) => (
          <ClipPlayer
            key={scope === 'inbox' && inboxViewer ? `${clip.id}-${index}` : clip.id}
            clip={clip}
            active={index === active && (!overlay || (desktop && commentsOpen))}
            nearby={Math.abs(index - active) <= 1}
            muted={muted}
            self={clip.author.id === profile.id}
            busy={busy.includes(clip.id)}
            playbackRate={playbackRate}
            onMute={() => setMuted(!muted)}
            onLike={() => void mutate(clip, 'like')}
            onFollow={() => void mutate(clip, 'follow')}
            onProfile={() =>
              setOverlay({ kind: 'profile', id: clip.author.id })
            }
            onComments={() => setOverlay({ kind: 'comments', clip })}
            onShare={() => setOverlay({ kind: 'share', clip })}
            onMenu={() => setOverlay({ kind: 'menu', clip })}
          />
        ))}
        {!clips.length && (
          <div className="clips-empty">
            <Icon name="film" size={42} />
            <h2>
              {loading
                ? 'Открываем видео'
                : error
                  ? 'Не удалось открыть ленту'
                  : scope === 'following'
                    ? 'Здесь будут ваши подписки'
                    : scope === 'author'
                      ? 'Пока нет видео'
                      : 'Первое видео — за вами'}
            </h2>
            <p>
              {loading
                ? 'Загружаем ролики…'
                : error ||
                  (scope === 'following'
                    ? 'Подпишитесь на авторов, которые вам нравятся.'
                    : 'Снимите момент или выберите видео из галереи.')}
            </p>
            {error ? (
              <button onClick={() => setRetry(retry + 1)}>
                Попробовать снова
              </button>
            ) : (
              !loading && (scope === 'following' || !desktop) && (
                <button
                  onClick={() =>
                    scope === 'following'
                      ? select('for-you')
                      : setOverlay({ kind: 'create' })
                  }
                >
                  {scope === 'following'
                    ? 'Открыть рекомендации'
                    : 'Создать видео'}
                </button>
              )
            )}
          </div>
        )}
        {clips.length > 0 && error && (
          <div className="clip-page-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError('')
                void loadMore()
              }}
            >
              Повторить
            </button>
          </div>
        )}
      </div>
      )}
      {(scope !== 'inbox' || inboxViewer) && clips.length > 0 && <nav className="desktop-clip-navigation" aria-label="Переключение видео">
        <button aria-label="Предыдущее видео" disabled={active === 0} onClick={() => feed.current?.scrollBy({ top: -feed.current.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><Icon name="chevron" /></button>
        <button aria-label="Следующее видео" disabled={active >= clips.length - 1} onClick={() => feed.current?.scrollBy({ top: feed.current.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><Icon name="chevron" /></button>
      </nav>}
      <input
        ref={input}
        hidden
        type="file"
        accept="video/*,.mov,.mp4,.webm"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) setOverlay({ kind: 'editor', file })
        }}
      />
      {toast && (
        <div role="status" className="clip-toast">
          {toast}
        </div>
      )}
      {overlay?.kind === 'create' && (
        <ClipSheet title="Новое видео" onClose={closeOverlay}>
          <div className="clip-menu">
            <button onClick={() => setOverlay({ kind: 'camera' })}>
              <Icon name="camera" />
              Снять видео
            </button>
            <button onClick={() => input.current?.click()}>
              <Icon name="photo" />
              Выбрать из галереи
            </button>
          </div>
        </ClipSheet>
      )}
      {overlay?.kind === 'camera' && (
        <Camera
          onClose={() => setOverlay({ kind: 'create' })}
          onFile={(file) => setOverlay({ kind: 'editor', file })}
        />
      )}
      {overlay?.kind === 'editor' && (
        <ClipEditor
          backRequest={editorBack}
          file={overlay.file}
          city={profile.city}
          onClose={closeOverlay}
          onPublished={() => {
            setOverlay(null)
            openAuthor(profile.id, 'Мои видео')
            setRetry((value) => value + 1)
            setToast('Видео опубликовано')
          }}
        />
      )}
      {overlay?.kind === 'share' && (
        <ClipSharing
          clipId={overlay.clip.id}
          host={host}
          onClose={closeOverlay}
        />
      )}
      {overlay?.kind === 'comments' && (
        <ClipComments
          clip={
            clips.find((item) => item.id === overlay.clip.id) || overlay.clip
          }
          currentUserId={profile.id}
          onClose={closeOverlay}
          onProfile={(id) => setOverlay({ kind: 'profile', id })}
          onCountChange={(delta) =>
            setClips((items) =>
              items.map((item) =>
                item.id === overlay.clip.id
                  ? {
                      ...item,
                      comment_count: Math.max(0, item.comment_count + delta),
                    }
                  : item,
              ),
            )
          }
          onNotice={setToast}
        />
      )}
      {overlay?.kind === 'profile' && (
        <ClipProfile
          id={overlay.id}
          self={overlay.id === profile.id}
          onFollowing={(following) =>
            setClips((items) =>
              items.flatMap((clip) => {
                if (clip.author.id !== overlay.id) return [clip]
                if (scope === 'following' && !following) return []
                return [{ ...clip, following }]
              }),
            )
          }
          onClose={closeOverlay}
          onVideos={openAuthor}
        />
      )}
      {overlay?.kind === 'menu' && (
        <ClipMenu
          clip={overlay.clip}
          self={overlay.clip.author.id === profile.id}
          host={host}
          playbackRate={playbackRate}
          onPlaybackRate={setPlaybackRate}
          onClose={closeOverlay}
          onRemove={(all) => remove(overlay.clip, all)}
        />
      )}
    </main>
  )
}
