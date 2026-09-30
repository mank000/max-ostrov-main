import type { ReactNode } from 'react'
import type { Profile } from '../api/users'
import { Avatar, Icon, type IconName } from '../ui/components/BasicUI'
import type { ServiceName } from './ServiceChooser'
import './desktop.css'
import './social-desktop-stable.css'

const services: { id: ServiceName; title: string; icon: IconName }[] = [
  { id: 'social', title: 'Социальная сеть', icon: 'users' },
  { id: 'dating', title: 'Знакомства', icon: 'heart' },
  { id: 'games', title: 'Игры', icon: 'game' },
  { id: 'clips', title: 'Видео', icon: 'film' },
]

const socialSections: { view: string; title: string }[] = [
  { view: 'feed', title: 'Лента' },
  { view: 'events', title: 'Мероприятия' },
  { view: 'map', title: 'Карта' },
  { view: 'friends', title: 'Друзья' },
]

export function PlatformLayout({ children, profile, service, view, currentMain, shared, notifications, friendRequests, clipNotifications, datingNotifications, onService, onHome, onOpen, onSocial }: {
  children: ReactNode
  profile: Profile
  service: ServiceName | null
  view: string
  currentMain: string
  shared: boolean
  notifications: number
  friendRequests: number
  clipNotifications: number
  datingNotifications: number
  onService: (service: ServiceName) => void
  onHome: () => void
  onOpen: (view: string) => void
  onSocial: (view: string) => void
}) {
  const socialOpen = service === 'social' && !shared
  const accountView = service === 'social' && (['profile', 'profileedit', 'profilephotos'].includes(view) ? 'profile' : view)
  const name = profile.display_name || profile.first_name

  return <div className="platform-layout" data-service={service || 'home'}>
    <aside className="desktop-sidebar" aria-label="Навигация приложения">
      <button className="desktop-brand" type="button" aria-label="Кутёж — главная" onClick={onHome}>
        <span className="desktop-brand-mark">К</span><span>Кутёж</span>
      </button>
      <nav className="desktop-primary-nav" aria-label="Сервисы">
        {services.map(item => <div className="desktop-nav-group" key={item.id}>
          <button type="button" aria-current={service === item.id && !shared ? 'page' : undefined} onClick={() => onService(item.id)}>
            <Icon name={item.icon} size={19} /><span>{item.title}</span>
            {item.id === 'clips' && clipNotifications > 0 && (
              <span className="desktop-badge" aria-label={`${clipNotifications} новых присланных видео`}>
                {clipNotifications > 99 ? '99+' : clipNotifications}
              </span>
            )}
            {item.id === 'dating' && datingNotifications > 0 && (
              <span className="desktop-badge" aria-label={`${datingNotifications} новых взаимных симпатий`}>
                {datingNotifications > 99 ? '99+' : datingNotifications}
              </span>
            )}
          </button>
          {item.id === 'social' && socialOpen && <nav className="desktop-subnav" aria-label="Разделы социальной сети">
            {socialSections.map(section => <button key={section.view} type="button"
              aria-current={currentMain === section.view ? 'page' : undefined}
              onClick={() => onSocial(section.view)}>
              <span>{section.title}</span>
              {section.view === 'friends' && friendRequests > 0 && <span className="desktop-badge">{friendRequests}</span>}
            </button>)}
          </nav>}
        </div>)}
      </nav>
      <div className="desktop-sidebar-bottom">
        <nav className="desktop-account-nav" aria-label="Аккаунт">
          <button type="button" aria-current={accountView === 'notifications' ? 'page' : undefined} onClick={() => onOpen('notifications')}>
            <Icon name="bell" size={19} /><span>Уведомления</span>
            {notifications > 0 && <span className="desktop-badge" aria-label={`${notifications} непрочитанных`}>{notifications > 99 ? '99+' : notifications}</span>}
          </button>
          <button type="button" aria-current={accountView === 'settings' ? 'page' : undefined} onClick={() => onOpen('settings')}>
            <Icon name="settings" size={19} /><span>Настройки</span>
          </button>
        </nav>
        <button className="desktop-user" type="button" aria-current={accountView === 'profile' ? 'page' : undefined} onClick={() => onOpen('profile')}>
          <Avatar name={name} url={profile.photo_url} size={34} />
          <span><strong>{name}</strong><small>{profile.city || 'Мой профиль'}</small></span>
        </button>
      </div>
    </aside>
    <div className="desktop-workspace"><div className="desktop-service-content">{children}</div></div>
  </div>
}
