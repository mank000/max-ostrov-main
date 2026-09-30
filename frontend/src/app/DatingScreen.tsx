import { useState } from 'react'
import type { CityPin } from '../ui-utils'
import { CityScreen } from '../screens/CityScreen'
import ProfileEditScreen from '../screens/ProfileEditScreen'
import { updateProfile, type Profile } from '../api/users'
import { Avatar, Icon } from '../ui/components/BasicUI'
import { MaxUI } from '@maxhub/max-ui'
import '@maxhub/max-ui/dist/styles.css'
import { App as DatingApp } from '../../../dating/frontend/src/App'
import '../../../dating/frontend/src/style.css'
import '../../../dating/frontend/src/embedded.css'
import { request } from '../api/http'
import { mediaURL } from '../api/credentials'

async function datingRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>('/dating' + path, {
    method, signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export default function DatingScreen({ theme, onBack, onProfile, onOpenChat, onOpenUserProfile, profile, onSaved, onCityChanged, unreadMatches, onMatchesRead }: {
  onCityChanged: (city: CityPin) => void
  profile: Profile
  onSaved: (profile: Profile) => void
  theme: 'light' | 'dark'
  onBack: () => void
  onProfile: () => void
  onOpenChat: (chatId: string) => void
  onOpenUserProfile: (userId: number) => void
  unreadMatches: number
  onMatchesRead: () => void
}) {
  const [panel, setPanel] = useState<'city' | 'photos' | null>(null)
  const [error, setError] = useState('')
  const [cityBusy, setCityBusy] = useState(false)
  const common = <div className="dating-shared-profile">
    <button type="button" className="dating-shared-photo" onClick={() => setPanel('photos')}>
      <Avatar name={profile.display_name} url={profile.photo_url} size={64} />
      <span><strong>{profile.display_name}{profile.age ? `, ${profile.age}` : ''}</strong><small>Изменить фотографии</small></span><Icon name="edit" size={20} />
    </button>
    <button type="button" className="dating-shared-city" disabled={cityBusy} onClick={() => setPanel('city')}><Icon name="pin" size={20} /><span>{cityBusy ? 'Сохраняем город…' : profile.city || 'Выбрать город'}</span><Icon name="chevron" size={18} /></button>
    {error && <p role="alert">{error}</p>}
  </div>
  return <>
    <div className="dating-container" hidden={Boolean(panel)}><MaxUI colorScheme={theme} className="dating-root">
      <DatingApp
        request={datingRequest}
        photoURL={mediaURL}
        colorScheme={theme}
        onBack={onBack}
        onProfile={onProfile}
        onOpenChat={onOpenChat}
        onMatchedProfile={(match) => onOpenUserProfile(match.user_id)}
        unreadMatches={unreadMatches}
        onMatchesRead={onMatchesRead}
        sharedProfile={common}
        profileRevision={JSON.stringify([profile.age, profile.gender, profile.city, profile.photo_url, profile.avatars])}
      />
    </MaxUI></div>
    {panel && <div className="app-shell">
      {panel === 'photos' ? <ProfileEditScreen profile={profile} photosOnly back={() => setPanel(null)} onSaved={onSaved} /> :
        <CityScreen back={() => setPanel(null)} city={profile.city} cityPin={null} setCityPin={pin => {
          if (!pin) return
          setCityBusy(true); setError('')
          void updateProfile({ city: pin.name }).then(updated => { onSaved(updated); onCityChanged(pin) }).catch(e => setError(e.message)).finally(() => setCityBusy(false))
        }} />}
    </div>}
  </>
}
