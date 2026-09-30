import { useEffect, useState } from 'react'
import {
  loadUserProfile,
  loadFollowing,
  setFollowing,
  type FollowState,
  type PublicUserProfile,
} from '../api/users'
import { Avatar } from '../ui/components/BasicUI'
import { loadClips, type Clip } from '../api/clips'
import { ClipCover } from './ClipCover'
import { Sheet as ClipSheet } from '../ui/components/Sheet'
export function ClipProfile({
  id,
  self,
  onFollowing,
  onClose,
  onVideos,
}: {
  id: number
  self: boolean
  onFollowing: (value: boolean) => void
  onClose: () => void
  onVideos: (id: number, name: string, clipID?: number) => void
}) {
  const [profile, setProfile] = useState<PublicUserProfile | null>(null)
  const [following, setFollowState] = useState<FollowState | null>(null)
  const [saving, setSaving] = useState(false)
  const [clips, setClips] = useState<Clip[]>([])
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    Promise.all([
      loadUserProfile(id, abort.signal),
      loadClips('author', '', id, abort.signal),
      loadFollowing(id, abort.signal),
    ])
      .then(([person, page, relation]) => {
        setFollowState(relation)
        setProfile(person)
        setClips(page.clips.slice(0, 6))
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err.message)
      })
    return () => abort.abort()
  }, [id, retry])
  async function toggleFollow() {
    if (!following || saving) return
    setSaving(true)
    setError('')
    const next = !following.following
    try {
      await setFollowing(id, next)
      setFollowState({
        ...following,
        following: next,
        followers: Math.max(0, following.followers + (next ? 1 : -1)),
      })
      onFollowing(next)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось сохранить подписку',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <ClipSheet title="Профиль" onClose={onClose}>
      {profile ? (
        <div className="clip-profile">
          <Avatar
            name={profile.display_name}
            url={profile.photo_url}
            size={80}
          />
          <h2>{profile.display_name}</h2>
          <p>
            {profile.username ? `@${profile.username} · ` : ''}
            {profile.city}
          </p>
          <p>{profile.bio}</p>
          {following && (
            <div className="clip-profile-stats">
              <span>
                <strong>{following.followers}</strong> подписчиков
              </span>
              <span>
                <strong>{following.following_count}</strong> подписок
              </span>
            </div>
          )}
          {!self && following && (
            <button
              disabled={saving}
              className={following.following ? 'clip-unfollow' : 'clip-primary'}
              onClick={() => void toggleFollow()}
            >
              {following.following ? 'Отписаться' : 'Подписаться'}
            </button>
          )}
          {error && (
            <p role="alert" className="clip-error">
              {error}
            </p>
          )}
          {clips.length > 0 && (
            <div className="clip-profile-grid">
              {clips.map((clip) => (
                <ClipCover
                  key={clip.id}
                  clip={clip}
                  onOpen={() => onVideos(id, profile.display_name, clip.id)}
                />
              ))}
            </div>
          )}
          <button
            className="clip-primary"
            onClick={() => onVideos(id, profile.display_name)}
          >
            Видео автора
          </button>
        </div>
      ) : error ? (
        <p role="alert">
          {error}
          <button onClick={() => setRetry(retry + 1)}>Повторить</button>
        </p>
      ) : (
        <p role="status">Загружаем профиль…</p>
      )}
    </ClipSheet>
  )
}
