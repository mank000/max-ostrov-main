import { AvatarLikes } from './AvatarLikes'
import { mediaURL } from '../../api/credentials'
import type { CSSProperties } from 'react'
import type { PostMedia } from '../../api/posts'
import { Icon } from './BasicUI'
import './media-viewer.css'
import { containMediaSize } from './media-viewer/geometry'
import { MediaVideo } from './media-viewer/MediaVideo'
import { pointerHandlers } from './media-viewer/pointer'
import { touchHandlers } from './media-viewer/touch'
import { useMediaView } from './media-viewer/useMediaView'
import { wheelHandlers } from './media-viewer/wheel'

export function MediaViewer({
  items,
  index,
  onIndexChange,
  onClose,
  onDownload,
  downloadBusy = false,
}: {
  items: PostMedia[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  downloadBusy?: boolean
  onDownload?: (item: PostMedia) => void
}) {
  const view = useMediaView(items, index, onIndexChange, onClose)
  const {
    item,
    isVideo,
    scale,
    fitSize,
    setFitSize,
    offset,
    drag,
    setDrag,
    dragRef,
    interacting,
    setInteracting,
    chromeVisible,
    chromeVisibleRef,
    stageRef,
    activeSlideRef,
    activeImageRef,
    gesture,
    lastTap,
    swipeAxis,
    scheduleChromeHide,
    previous,
    next,
  } = view
  const { pointerDown, pointerMove, finishPointerGesture } = pointerHandlers(view, items, index, onClose)
  const { wheel } = wheelHandlers(view, items, index, onClose)
  const { touchStart, touchMove, touchEnd } = touchHandlers(view, items, index, onClose)
  if (!item) return null
  const stageStyle = {
    '--viewer-base-x': `${-index * 100}%`,
    '--viewer-page-x': `${drag.x}px`,
    '--viewer-page-y': `${drag.y}px`,
  } as CSSProperties
  const imageStyle = {
    width: fitSize ? `${fitSize.width}px` : '100%',
    height: fitSize ? `${fitSize.height}px` : '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
  } as CSSProperties

  return (
    <section
      className={`pro-media-viewer ${isVideo ? 'is-video-view' : ''} ${items.length > 1 ? 'has-media-nav' : ''} ${interacting ? 'is-interacting' : ''} ${chromeVisible ? '' : 'is-chrome-hidden'}`}
      style={stageStyle}
      aria-label={isVideo ? 'Просмотр видео' : 'Просмотр фотографии'}
    >
      <header className="pro-media-viewer__top">
        <button type="button" onClick={onClose} aria-label="Закрыть" title="Закрыть (Esc)">
          <Icon name="close" size={24} />
        </button>
        <div>
          <strong>{isVideo ? 'Видео' : 'Фото'}</strong>
          <span>
            {index + 1} из {items.length}
          </span>
        </div>
        {onDownload && !isVideo ? (
          <button type="button" disabled={downloadBusy} aria-busy={downloadBusy} onClick={() => onDownload(item)} aria-label={downloadBusy ? "Подготовка файла" : "Скачать"}>
            <Icon name="download" size={23} />
          </button>
        ) : (
          <span className="pro-media-viewer__top-spacer" />
        )}
      </header>

      <section
        ref={stageRef}
        className="pro-media-viewer__stage"
        data-content-zoom
        aria-label={
          isVideo ? 'Видео, жесты для перехода между медиа' : 'Фото, жесты для перехода между медиа'
        }
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(event) => finishPointerGesture(event)}
        onPointerCancel={(event) => finishPointerGesture(event, true)}
        onWheel={wheel}
        onTouchStart={touchStart}
        onTouchMove={touchMove}
        onTouchEnd={touchEnd}
        onTouchCancel={() => {
          setInteracting(false)
          dragRef.current = { x: 0, y: 0 }
          setDrag(dragRef.current)
          gesture.current.kind = 'none'
          swipeAxis.current = 'none'
          lastTap.current = null
          if (chromeVisibleRef.current) scheduleChromeHide()
        }}
      >
        <div className="pro-media-viewer__track">
          {items.map((entry, itemIndex) => {
            const video = entry.mime_type?.startsWith('video/')
            const active = itemIndex === index
            return (
              <div
                ref={active ? activeSlideRef : undefined}
                className={`pro-media-viewer__slide ${active ? 'is-active' : ''}`}
                key={entry.id || entry.url}
                aria-hidden={!active}
              >
                {video ? (
                  <MediaVideo src={mediaURL(entry.url)} active={active} nearby={Math.abs(itemIndex - index) <= 1} />
                ) : (
                  <img
                    ref={active ? activeImageRef : undefined}
                    src={mediaURL(entry.url)}
                    alt=""
                    draggable={false}
                    loading={Math.abs(itemIndex - index) <= 1 ? 'eager' : 'lazy'}
                    decoding="async"
                    style={active ? imageStyle : undefined}
                    onLoad={
                      active
                        ? () => {
                          const slide = activeSlideRef.current
                          const image = activeImageRef.current
                          if (!slide || !image) return
                          const rect = slide.getBoundingClientRect()
                          const next = containMediaSize(
                            rect.width,
                            rect.height,
                            image.naturalWidth || entry.width,
                            image.naturalHeight || entry.height,
                          )
                          if (next) setFitSize(next)
                        }
                        : undefined
                    }
                  />
                )}
              </div>
            )
          })}
        </div>
      </section>

      {item.avatar_owner_id && <AvatarLikes key={`${item.avatar_owner_id}:${item.id}`} owner={item.avatar_owner_id} media={item.id} />}
      <footer className="pro-media-viewer__nav">
        <button type="button" onClick={previous} disabled={index <= 0} aria-label="Предыдущее">
          <Icon name="back" size={24} />
        </button>
        <nav className="pro-media-viewer__dots" aria-label="Навигация по медиа">
          {items.slice(0, 12).map((entry, itemIndex) => (
            <button
              key={entry.id || entry.url}
              type="button"
              className={itemIndex === index ? 'is-active' : ''}
              onClick={() => onIndexChange(itemIndex)}
              aria-label={`Открыть ${itemIndex + 1}`}
            />
          ))}
        </nav>
        <button
          type="button"
          onClick={next}
          disabled={index >= items.length - 1}
          aria-label="Следующее"
        >
          <Icon name="chevron" size={24} />
        </button>
      </footer>
    </section>
  )
}

export default MediaViewer
