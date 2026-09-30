import { lazy, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { loadEvent, type Event } from '../api/events'
import type { Post, PostMedia } from '../api/posts'
import type { HostAdapter } from '../host'
import type { Route } from '../routes'
import { EventScreen } from '../screens/EventScreen'
import { EventsScreen } from '../screens/EventsTab'
import { FeedScreen } from '../screens/FeedTab'
import { FriendsScreen } from '../screens/FriendsTab'
import { ProfileScreen } from '../screens/ProfileTab'
import type { CityPin } from '../ui-utils'
import { Header, StatePanel } from '../ui/components/BasicUI'
import type { AppDataResult } from '../useAppData'
import type { useTheme } from '../useTheme'
import type { useFeedback } from './useFeedback'
import type { useNavigation } from './useNavigation'
import type { usePostActions } from './usePostActions'
import type { useSharing } from './useSharing'

const CommentsScreen = lazy(() => import('../screens/CommentsScreen'))
const CreateEventScreen = lazy(() => import('../screens/CreateEventScreen'))
const CreatePostScreen = lazy(() => import('../screens/CreatePostScreen'))
const ProfileEditScreen = lazy(() => import('../screens/ProfileEditScreen'))
const MediaViewer = lazy(() => import('../ui/components/MediaViewer'))
const MorePage = lazy(() => import('../screens/MorePages'))

type Props = {
  activeRoute: Route
  auth: { state: string; error: string; retry: () => void }
  data: AppDataResult
  host: HostAdapter
  navigation: ReturnType<typeof useNavigation>
  openClip: (clipId: number, comments?: boolean) => void
  settings: Pick<ReturnType<typeof useTheme>, 'theme' | 'themeMode' | 'changeTheme'> & {
    cityName: string; cityPin: CityPin | null; setCityPin: Dispatch<SetStateAction<CityPin | null>>; maxBotName: string
  }
  feedback: ReturnType<typeof useFeedback>
  sharing: ReturnType<typeof useSharing>
  posts: ReturnType<typeof usePostActions> & {
    linkedPost: Post | null; postLookupLoading: boolean; postLookupError: string
    retry: () => void; created: (post: Post) => void
  }
  events: { created: (event: Event) => void; updated: (event: Event) => void; deleted: (id: number) => void }
  media: {
    items: PostMedia[]; index: number; setIndex: (index: number) => void
    openMedia: (value: PostMedia | string, items?: PostMedia[]) => void
    downloadBusy: boolean
    downloadMedia: (item: PostMedia) => Promise<void>
  }
}

export function ScreenRouter({ activeRoute, auth, data, host, navigation, openClip, settings, feedback, sharing, posts, events, media }: Props) {
  const { route, navigate, back, openEventOnMap } = navigation
  const { cityName, cityPin, setCityPin, theme, themeMode, changeTheme, maxBotName } = settings
  const { showError, setModal, setToast } = feedback
  const { share, messageFriend } = sharing
  const { linkedPost, postLookupLoading, postLookupError, like, changePostCommentCount, refreshPost } = posts
  const { openMedia, downloadMedia } = media
  const { updated: handleEventUpdated, deleted: handleEventDeleted } = events
  let screen: ReactNode
  const activePost = [
    ...data.posts,
    ...data.profilePosts,
    ...(linkedPost ? [linkedPost] : []),
  ].find((item) => item.id === activeRoute.id)
  const activePostLoading =
    activeRoute.view === route.view && activeRoute.id === route.id ? postLookupLoading : false
  if (
    auth.state === 'guest' &&
    !['map', 'events', 'event', 'city', 'filters'].includes(activeRoute.view)
  ) {
    screen = (
      <>
        <Header title="Кутёж" />
        <div className="screen-scroll">
          <StatePanel
            title={auth.error ? 'Не удалось войти' : 'Войдите, чтобы продолжить'}
            description={
              auth.error || 'Откройте приложение через MAX, чтобы видеть публикации и друзей.'
            }
            action="Повторить"
            onAction={auth.retry}
          />
        </div>
      </>
    )
  } else
    switch (activeRoute.view) {
      case 'feed':
        screen = (
          <FeedScreen
            data={data}
            city={cityName}
            navigate={navigate}
            onLike={like}
            onShare={share}
            onMedia={openMedia}
          />
        )
        break
      case 'events':
        screen = <EventsScreen city={cityName} data={data} navigate={navigate} />
        break
      case 'map':
        screen = null
        break
      case 'friends':
        screen = (
          <FriendsScreen
            data={data}
            navigate={navigate}
            onMessage={(userId) => void messageFriend(userId)}
            onError={showError}
            confirm={setModal}
          />
        )
        break
      case 'profile':
        screen = (
          <ProfileScreen
            data={data}
            navigate={navigate}
            onLike={like}
            onShare={share}
            onMedia={openMedia}
          />
        )
        break
      case 'post':
      case 'comments':
        screen =
          !activePost && postLookupError ? (
            <>
              <Header title="Публикация" back={back} />
              <StatePanel
                title="Не удалось загрузить публикацию"
                description={postLookupError}
                action="Повторить"
                onAction={posts.retry}
              />
            </>
          ) : (
            <CommentsScreen
              postId={activeRoute.id || 0}
              post={activePost}
              postLoading={activePostLoading || data.status.feed.loading}
              currentUserId={data.profile?.id || 0}
              isAdmin={data.profile?.moderation_role === 'administrator'}
              back={back}
              navigate={navigate}
              onLike={like}
              onShare={share}
              onMedia={openMedia}
              confirm={setModal}
              onCommentCountChange={(delta) => changePostCommentCount(activeRoute.id || 0, delta)}
              onChanged={() => refreshPost(activeRoute.id || 0)}
              onNotice={setToast}
              title="Публикация"
            />
          )
        break
      case 'event':
        screen = (
          <EventScreen
            eventId={activeRoute.id || 0}
            data={data}
            back={back}
            navigate={navigate}
            onMap={openEventOnMap}
            onTicket={host.openLink}
            confirm={setModal}
            onNotice={setToast}
          />
        )
        break
      case 'profileedit':
        screen = data.profile ? (
          <ProfileEditScreen profile={data.profile} back={back} onSaved={data.setProfile} />
        ) : (
          <StatePanel title="Профиль не найден" action="Назад" onAction={back} />
        )
        break
      case 'createpost':
        screen = (
          <CreatePostScreen
            city={cityName}
            data={data}
            back={back}
            onCreated={posts.created}
          />
        )
        break
      case 'createevent':
        screen = (
          <CreateEventScreen
            city={cityName}
            back={back}
            onCreated={events.created}
          />
        )
        break
      case 'media':
        screen = (
          <MediaViewer
            items={media.items}
            index={media.index}
            onIndexChange={media.setIndex}
            onClose={back}
            onDownload={(item) => void downloadMedia(item)}
            downloadBusy={media.downloadBusy}
          />
        )
        break
      default:
        screen = (
          <MorePage
            route={activeRoute}
            active={activeRoute === route}
            data={data}
            city={cityName}
            cityPin={cityPin}
            setCityPin={setCityPin}
            theme={theme}
            themeMode={themeMode}
            setTheme={changeTheme}
            maxBotName={maxBotName}
            navigate={navigate}
            back={back}
            openMedia={openMedia}
            onLike={like}
            onError={showError}
            confirm={setModal}
            host={host}
            openClip={openClip}
            event={activeRoute.id ? data.eventOverrides[activeRoute.id] : undefined}
            loadEvent={loadEvent}
            onEventUpdated={handleEventUpdated}
            onEventDeleted={handleEventDeleted}
          />
        )
    }
  return screen
}
