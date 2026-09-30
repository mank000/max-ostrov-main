import { dismissTopDialog } from './ui/dialogs'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PlatformLayout } from './app/PlatformLayout'
import { ServiceChooser, type ServiceName } from './app/ServiceChooser'
import { useDeviceLayout } from './app/useDeviceLayout'
import { useSession } from './app/useSession'
import { useAppInfo } from './app/useAppInfo'
import { DemoLogin } from './app/DemoLogin'
import { type Event } from './api/events'
import { loadPost, type Post } from './api/posts'
import { markDatingMatchesRead } from './api/notifications'
import { OverlayHost } from './app/OverlayHost'
import { ScreenRouter } from './app/ScreenRouter'
import { useMediaDownload } from './app/useMediaDownload'
import { useAppMedia } from './app/useAppMedia'
import { useFeedback } from './app/useFeedback'
import { useModerationNotice } from './app/useModerationNotice'
import { useNavigation } from './app/useNavigation'
import { usePostActions } from './app/usePostActions'
import { useSharing } from './app/useSharing'
import { usePostUpdate } from './data/usePostUpdates'
import { getHost } from './host'
import './onboarding.css'
import { mainViews } from './routes'

import { MapScreen } from './screens/MapScreen'

import './share-sheet.css'
import { savedCity, saveSetting, type CityPin } from './ui-utils'
import { BottomNavigation, Header, StatePanel } from './ui/components/BasicUI'
import type { MenuAnchor } from './ui/components/ContextMenu'

import './ui/motion.css'
import './ui/tokens.css'
import { useAppData } from './useAppData'
import { usePresence } from './usePresence'
import { useTheme } from './useTheme'

const ClipsScreen = lazy(() => import('./clips/ClipsScreen'))
const GamesScreen = lazy(() => import('./app/GamesScreen'))
const DatingScreen = lazy(() => import('./app/DatingScreen'))
const OnboardingScreen = lazy(() => import('./screens/OnboardingScreen'))

export function App() {
  const host = useMemo(getHost, [])
  const desktop = useDeviceLayout()
  const [service, setService] = useState<ServiceName | null>(desktop ? 'social' : null)
  const [lastService, setLastService] = useState<ServiceName>('social')
  const serviceReturnRef = useRef<ServiceName | null>(null)
  const [clipTarget, setClipTarget] = useState<{
    id: number
    comments: boolean
  } | null>(null)
  const chooseServices = useCallback(() => {
    const returnService = serviceReturnRef.current
    serviceReturnRef.current = null
    setClipTarget(null)
    if (returnService) {
      setLastService(returnService)
      setService(returnService)
    } else {
      setService(desktop ? 'social' : null)
    }
  }, [desktop])
  useLayoutEffect(() => {
    if (desktop && service === null) {
      setService('social')
    }
  }, [desktop, service])
  const openClip = useCallback((id: number, comments = false) => {
    if (!Number.isSafeInteger(id) || id <= 0) {
      return
    }
    setClipTarget({ id, comments })
    setLastService('clips')
    setService('clips')
  }, [])
  const { status: session, user: sessionUser, error: authError, retry: retryLogin, accept: acceptSession } = useSession()
  const { botName: maxBotName, demoMode } = useAppInfo()
  const [maintenance, setMaintenance] = useState(false)
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const { theme, themeMode, changeTheme } = useTheme(host)
  const [cityPin, setCityPin] = useState<CityPin | null>(savedCity)
  const feedback = useFeedback()
  const { modal, setModal, setToast, showError } = feedback
  const [actionMenu, setActionMenu] = useState<{
    view: 'postactions' | 'usermenu'
    id: number
    anchor?: MenuAnchor
  } | null>(null)
  const [linkedPost, setLinkedPost] = useState<Post | null>(null)
  usePostUpdate(linkedPost, setLinkedPost)
  const [postLookupLoading, setPostLookupLoading] = useState(false)
  const [postLookupError, setPostLookupError] = useState('')
  const [postRetry, setPostRetry] = useState(0)
  const onUnauthorized = useCallback(() => {
    acceptSession(null)
    setService(null)
    setClipTarget(null)
    setModal({
      title: 'Сессия завершилась',
      description: demoMode ? 'Выберите тестовый профиль ещё раз.' : 'Откройте приложение через MAX и войдите снова.',
      confirm: 'Понятно',
      onConfirm: () => setModal(null),
    })
  }, [acceptSession, demoMode, setModal])
  const data = useAppData(
    session === 'authenticated' && !maintenance,
    onUnauthorized,
    cityPin?.name || '',
    service === 'social',
    service === 'clips',
  )
  const socialReady =
    session === 'authenticated' &&
    !maintenance &&
    service === 'social' &&
    (data.profile?.onboarding_version ?? 0) >= 1
  useModerationNotice(
    session === 'authenticated' ? data.profile?.id : undefined,
    data.unreadNotificationCount,
    modal,
    setModal,
  )
  const cityName = cityPin?.name || data.profile?.city || ''
  const sharing = useSharing(data, host, cityName, maxBotName, setModal, setToast, showError)
  const { sharePost, setSharePost } = sharing

  const closeOverlay = useCallback(() => {
    if (actionMenu) {
      setActionMenu(null)
    } else if (sharePost) {
      setSharePost(null)
    } else if (modal) {
      setModal(null)
    }
  }, [actionMenu, sharePost, modal, setSharePost, setModal])
  const navigation = useNavigation(
    host,
    data.profile?.id,
    setActionMenu,
    Boolean(actionMenu || modal || sharePost),
    closeOverlay,
    service === 'social',
    chooseServices,
  )
  const {
    route,
    mapVisited,
    mapFocusTarget,
    setMapFocusTarget,
    shellRef,
    contentRef,
    mapHostRef,
    navigate,
    routeTrail,
    mapInTrail,
    replaceRoute,
  } = navigation
  useEffect(() => {
    if (service === 'social' || service === 'clips') {
      return
    }
    const button = host.backButton
    const closeOrExit = () => {
      if (!dismissTopDialog()) {
        chooseServices()
      }
    }
    if (service === 'dating') {
      button?.show()
      button?.onClick(closeOrExit)
    } else {
      button?.hide()
    }
    return () => button?.offClick(closeOrExit)
  }, [host, service, chooseServices])
  useEffect(() => {
    if (cityPin) {
      saveSetting('kutezh-selected-city', JSON.stringify(cityPin))
    } else {
      saveSetting('kutezh-selected-city', null)
    }
  }, [cityPin])
  useEffect(() => {
    const online = () => setOffline(false)
    const unavailable = () => setMaintenance(true)
    window.addEventListener('kutezh:maintenance', unavailable)
    const disconnected = () => setOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', disconnected)
    window.addEventListener('kutezh:session-expired', onUnauthorized)
    return () => {
      window.removeEventListener('kutezh:maintenance', unavailable)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', disconnected)
      window.removeEventListener('kutezh:session-expired', onUnauthorized)
    }
  }, [onUnauthorized])
  usePresence(session === 'authenticated' && !maintenance)

  const handleEventUpdated = useCallback(
    (event: Event) => {
      data.applyEventUpdate(event)
      data.refresh('activity', 'recommendations')
      setToast('Мероприятие обновлено')
    },
    [data.applyEventUpdate, data.refresh],
  )

  const handleEventDeleted = useCallback(
    (eventId: number) => {
      data.applyEventDelete(eventId)
      data.refresh('activity', 'recommendations')
      setMapFocusTarget((current) => (current?.eventId === eventId ? null : current))
      setActionMenu(null)
      replaceRoute('myevents', undefined, true)
      setToast('Мероприятие удалено')
    },
    [data.applyEventDelete, data.refresh, replaceRoute, setMapFocusTarget, setToast],
  )

  const postActions = usePostActions(data, host, setLinkedPost, setModal)
  const { like } = postActions
  const allPosts = [...data.posts, ...data.profilePosts, ...(linkedPost ? [linkedPost] : [])]

  const { media, setMedia, openMedia } = useAppMedia(allPosts, navigate)
  const { downloadMedia, downloadBusy } = useMediaDownload(
    media.items[media.index],
    route.view === 'media' && socialReady,
    host,
    showError,
  )
  useEffect(() => {
    if (session !== 'guest') {
      return
    }
    data.clearPrivateData()
    setLinkedPost(null)
    setActionMenu(null)
    setSharePost(null)
    setMedia({ items: [], index: 0 })
    setPostLookupError('')
    setPostLookupLoading(false)
  }, [session, data.clearPrivateData, setSharePost, setMedia])
  const post = allPosts.find((item) => item.id === route.id)
  useEffect(() => {
    if (!socialReady || !['post', 'comments'].includes(route.view) || !route.id || post) {
      return
    }
    const id = route.id
    const controller = new AbortController()
    setPostLookupLoading(true)
    setPostLookupError('')
    void loadPost(id, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) {
          setPostLookupLoading(false)
          setLinkedPost(found)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPostLookupError(
            error instanceof Error ? error.message : 'Не удалось загрузить публикацию',
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPostLookupLoading(false)
        }
      })
    return () => controller.abort()
  }, [socialReady, route.view, route.id, post, postRetry])
  function postCreated(post: Post) {
    setLinkedPost(post)
    replaceRoute('post', post.id)
    setToast('Публикация опубликована')
  }
  function eventCreated(event: Event) {
    data.applyEventUpdate(event)
    data.setParticipatingEventIds((current) => new Set(current).add(event.id))
    data.refresh('activity', 'recommendations')
    replaceRoute('event', event.id)
    setToast('Мероприятие создано')
  }
  const navigationBadges = {
    friends: data.friendRequestCount,
    feed: data.unreadNotificationCount,
  }
  if (maintenance) {
    return (
      <main
        className="app-shell"
        style={{ justifyContent: 'center' }}
      >
        <StatePanel
          title="Дорабатываем приложение"
          description="Скоро вернемся"
        />
      </main>
    )
  }

  if (session === 'loading') {
    return (
      <div className="app-shell">
        <StatePanel
          title=""
          loading
        />
      </div>
    )
  }
  if (offline) {
    return (
      <div className="app-shell">
        <Header title="Кутёж" />
        <div className="screen-scroll">
          <StatePanel
            title="Вы не в сети"
            description="Проверьте подключение к интернету и попробуйте снова."
            action="Повторить"
            onAction={() => {
              setOffline(!navigator.onLine)
              if (navigator.onLine) {
                data.refreshAll()
              }
            }}
          />
        </div>
      </div>
    )
  }
  if (session === 'guest') {
    if (demoMode) return <DemoLogin onSignedIn={acceptSession} />
    return (
      <div className="app-shell">
        <Header title="Кутёж" />
        <StatePanel
          title={authError ? 'Не удалось войти' : 'Добро пожаловать в Кутёж'}
          description={
            authError ||
            'Откройте мини-приложение через MAX, чтобы войти или зарегистрироваться. Один аккаунт откроет все сервисы.'
          }
          action="Повторить вход"
          onAction={retryLogin}
        />
      </div>
    )
  }
  if (session === 'authenticated' && !data.profile) {
    return (
      <div className="app-shell">
        <div className="screen-scroll">
          <StatePanel
            title={data.status.profile.error ? 'Не удалось загрузить профиль' : ''}
            description={data.status.profile.error}
            loading={!data.status.profile.error}
            action={data.status.profile.error ? 'Повторить' : undefined}
            onAction={data.status.profile.error ? () => data.refresh('profile') : undefined}
          />
        </div>
      </div>
    )
  }
  if (session === 'authenticated' && data.profile && (data.profile.onboarding_version ?? 0) < 1) {
    return (
      <div className="app-shell">
        <Suspense
          fallback={
            <StatePanel
              title=""
              loading
            />
          }
        >
          <OnboardingScreen
            profile={data.profile}
            providerUser={sessionUser}
            host={host}
            onComplete={(profile) => {
              data.setProfile(profile)
              host.hapticImpact('medium')
            }}
          />
        </Suspense>
      </div>
    )
  }
  const selectService = (value: ServiceName) => {
    if (navigation.fromServices) {
      navigation.exitToServices()
    }
    if (desktop && value === 'social') {
      replaceRoute('feed', undefined, true)
    }
    host.hapticSelection()
    setClipTarget(null)
    setLastService(value)
    setService(value)
  }
  const openShared = (view: string) => {
    if (service === 'social' && !navigation.fromServices) {
      navigate(view)
    } else {
      navigation.openFromServices(view)
    }
    setClipTarget(null)
    setLastService('social')
    setService('social')
  }
  const openDatingUserProfile = (userId: number) => {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return
    }
    serviceReturnRef.current = 'dating'
    navigation.openFromServices('userprofile')
    replaceRoute('userprofile', userId)
    setLastService('dating')
    setService('social')
  }
  const openHome = () => {
    serviceReturnRef.current = null
    navigation.exitToServices()
    if (desktop) {
      setLastService('social')
      setService('social')
      replaceRoute('feed', undefined, true)
    }
  }
  const layout = (children: React.ReactNode) => (
    <>
    {demoMode && <div className="demo-badge" role="note">Демо · вымышленные данные</div>}
    <PlatformLayout
      profile={data.profile!}
      service={service}
      view={route.view}
      currentMain={navigation.currentMain}
      shared={navigation.fromServices}
      notifications={data.unreadNotificationCount}
      friendRequests={data.friendRequestCount}
      clipNotifications={data.unreadClipCount + data.unreadClipMessageCount}
      datingNotifications={data.unreadMatchCount}
      onService={selectService}
      onHome={openHome}
      onOpen={openShared}
      onSocial={navigate}
    >
      {children}
    </PlatformLayout>
    </>
  )
  const serviceChooser = !desktop && (
    <ServiceChooser
      profile={data.profile!}
      initialService={lastService}
      notifications={data.unreadNotificationCount}
      clipNotifications={data.unreadClipCount + data.unreadClipMessageCount}
      datingNotifications={data.unreadMatchCount}
      onSelect={selectService}
      onUnauthorized={onUnauthorized}
      onOpen={(view) => {
        setLastService('social')
        setService('social')
        navigation.openFromServices(view)
      }}
    />
  )
  if (!service) {
    return layout(serviceChooser)
  }
  if (service === 'clips') {
    return layout(
      <Suspense
        fallback={
          <div className="app-shell">
            <StatePanel
              title="Открываем видео"
              loading
            />
          </div>
        }
      >
        <ClipsScreen
          profile={data.profile!}
          host={host}
          onBack={chooseServices}
          initialClipId={clipTarget?.id}
          initialOpenComments={clipTarget?.comments}
          unreadInbox={data.unreadClipCount + data.unreadClipMessageCount}
          onInboxRead={() => data.refresh('inbox')}
        />
      </Suspense>,
    )
  }
  if (service === 'games') {
    return layout(
      <Suspense
        fallback={
          <div className="app-shell">
            <StatePanel
              title="Открываем игры"
              loading
            />
          </div>
        }
      >
        <GamesScreen
          theme={theme}
          userId={data.profile!.id}
          onBack={chooseServices}
        />
      </Suspense>,
    )
  }
  if (service === 'dating') {
    return layout(
      <Suspense
        fallback={
          <div className="app-shell">
            <StatePanel
              title="Открываем знакомства"
              loading
            />
          </div>
        }
      >
        <DatingScreen
          onCityChanged={setCityPin}
          profile={data.profile!}
          onSaved={data.setProfile}
          theme={theme}
          onBack={chooseServices}
          unreadMatches={data.unreadMatchCount}
          onMatchesRead={() => {
            if (data.unreadMatchCount <= 0) {
              return
            }
            void markDatingMatchesRead()
              .then(() => data.refresh('inbox'))
              .catch(() => {})
          }}
          onProfile={() => {
            setService('social')
            navigate('profileedit')
          }}
          onOpenUserProfile={openDatingUserProfile}
          onOpenChat={(id) => {
            if (!host.openChat(id)) {
              throw new Error('Не удалось открыть чат в MAX')
            }
          }}
        />
      </Suspense>,
    )
  }
  return layout(
    <div
      ref={shellRef}
      className="app-shell social-shell"
      data-screen={route.view}
    >
      {!desktop && (
        <div className="service-return-bar">
          <button
            type="button"
            onClick={navigation.exitToServices}
          >
            ‹ Разделы
          </button>
        </div>
      )}
      <main
        ref={contentRef}
        className="app-content"
        id="app"
        data-view={route.view}
      >
        {(mapVisited || mapInTrail) && (
          <div
            ref={mapHostRef}
            className="map-host"
            hidden={!mapInTrail}
          >
            <MapScreen
              city={cityPin}
              cityName={cityName}
              theme={theme}
              active={route.view === 'map'}
              focusTarget={mapFocusTarget}
              navigate={navigate}
              data={data}
            />
          </div>
        )}
        {routeTrail.map((entry, index) => {
          const role =
            index === routeTrail.length - 1
              ? 'current'
              : index === routeTrail.length - 2
                ? 'previous'
                : 'background'
          return (
            <section
              key={entry.key}
              className="route-layer"
              data-layer-role={role}
              data-view={entry.view}
              aria-hidden={role !== 'current'}
              inert={role !== 'current'}
            >
              {entry.view === 'services' ? (
                serviceChooser
              ) : (
                <Suspense
                  fallback={
                    <StatePanel
                      title=""
                      loading
                    />
                  }
                >
                  <ScreenRouter
                    activeRoute={entry}
                    auth={{
                      state: session,
                      error: authError,
                      retry: retryLogin,
                    }}
                    data={data}
                    host={host}
                    navigation={navigation}
                    openClip={openClip}
                    feedback={feedback}
                    sharing={sharing}
                    settings={{
                      cityName,
                      cityPin,
                      setCityPin,
                      theme,
                      themeMode,
                      changeTheme,
                      maxBotName,
                    }}
                    posts={{
                      ...postActions,
                      linkedPost,
                      postLookupLoading,
                      postLookupError,
                      retry: () => setPostRetry((value) => value + 1),
                      created: postCreated,
                    }}
                    events={{
                      created: eventCreated,
                      updated: handleEventUpdated,
                      deleted: handleEventDeleted,
                    }}
                    media={{
                      ...media,
                      setIndex: (index) => setMedia((current) => ({ ...current, index })),
                      openMedia,
                      downloadMedia,
                      downloadBusy,
                    }}
                  />
                </Suspense>
              )}
              {!navigation.fromServices && mainViews.has(entry.view) && (
                <BottomNavigation
                  current={entry.view}
                  onSelect={(view) => navigate(view)}
                  badges={navigationBadges}
                />
              )}
            </section>
          )
        })}
      </main>
      <OverlayHost
        actionMenu={actionMenu}
        closeMenu={() => setActionMenu(null)}
        data={data}
        navigation={navigation}
        sharing={sharing}
        feedback={feedback}
        host={host}
        like={like}
        openMedia={openMedia}
      />
    </div>,
  )
}
