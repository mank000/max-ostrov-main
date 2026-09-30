import { mediaURL } from '../api/credentials'
import { Button, Header, StatePanel } from '../ui/components/BasicUI'
import './extras.css'
import type { ScreenProps } from './screen-types'

export function Photos({ back, data, openMedia }: ScreenProps) {
  const media = data.profilePosts.flatMap((post) => post.media)
  return (
    <>
      <Header title="Медиа" back={back} />
      <div className="screen-scroll">
        {data.status.profilePosts.loading ? (
          <StatePanel title="" loading />
        ) : data.status.profilePosts.error ? (
          <StatePanel
            title="Не удалось загрузить медиа"
            description={data.status.profilePosts.error}
            action="Повторить"
            onAction={() => data.refresh('profilePosts')}
          />
        ) : null}
        {media.length ? (
          <div className="extra-photos">
            {media.map((item) => (
              <button key={item.id} type="button" onClick={() => openMedia(item, media)}>
                {item.mime_type.startsWith('video/') ? (
                  <>
                    <video src={mediaURL(item.url)} muted playsInline preload="metadata" />
                    <span className="extra-photos__video">▶</span>
                  </>
                ) : (
                  <img src={mediaURL(item.url)} alt="Фотография" />
                )}
              </button>
            ))}
          </div>
        ) : (
          !data.status.profilePosts.loading &&
          !data.status.profilePosts.error && <StatePanel title="Пока нет медиа" />
        )}
        {data.profilePostsNextCursor && (
          <div className="page-pad load-more">
            <Button
              variant="secondary"
              disabled={data.loadingMoreProfilePosts}
              onClick={() => void data.loadMoreProfilePosts()}
            >
              {data.loadingMoreProfilePosts ? 'Загрузка…' : 'Показать ещё'}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
