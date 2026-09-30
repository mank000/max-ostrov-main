import { useEffect, useState } from 'react'
import { loadReceivedGifts, loadUserGifts, type Gift } from '../../api/rewards'
import { Avatar, Button, Header, Icon, StatePanel } from '../../ui/components/BasicUI'
import { GiftArtwork } from '../../ui/components/GiftArtwork'
import { useExpandableSheet } from '../../ui/components/useExpandableSheet'
import type { ScreenProps } from '../screen-types'
import { giftTheme } from './giftThemes'

export function GiftDetailSheet({
  gift,
  onClose,
  onGiftAgain,
}: {
  gift: Gift
  onClose: () => void
  onGiftAgain: () => void
}) {
  const theme = giftTheme(gift.item_code)
  const { sheetRef, handleProps, expanded } = useExpandableSheet<HTMLElement>({
    onClose,
  })
  return (
    <div className="gift-detail-backdrop" role="presentation">
      <button
        className="sheet-backdrop-dismiss"
        type="button"
        tabIndex={-1}
        aria-label="Закрыть подарок"
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className="gift-detail-sheet"
        data-sheet-expanded={expanded}
        data-gift-theme={theme}
        role="dialog"
        aria-modal="true"
        aria-label={`Подарок «${gift.title}»`}
      >
        <button {...handleProps} />
        <div className="gift-detail-sheet__body" data-sheet-scroll>
          <span className="gift-detail-sheet__eyebrow">
            Подарок от {gift.sender?.display_name || 'пользователя'}
          </span>
          <div className="gift-detail-sheet__art">
            <GiftArtwork code={gift.item_code} size={152} />
          </div>
          <h2>{gift.title}</h2>
          {gift.message && <p>«{gift.message}»</p>}
          <small>
            {new Intl.DateTimeFormat('ru-RU', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(new Date(gift.created_at))}
          </small>
        </div>
        <div className="gift-detail-sheet__actions">
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button onClick={onGiftAgain}>Подарить другу</Button>
        </div>
      </section>
    </div>
  )
}

export function Gifts({ route, back, navigate, onError }: ScreenProps) {
  const targetUserId = route.view === 'usergifts' ? route.id : undefined
  const [items, setItems] = useState<Gift[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGift, setSelectedGift] = useState<Gift | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const request = targetUserId
      ? loadUserGifts(targetUserId, undefined, controller.signal)
      : loadReceivedGifts(undefined, controller.signal)
    request
      .then((value) => setItems(value.gifts))
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [targetUserId, onError])
  return (
    <>
      <Header title="Подарки" back={back} />
      <div className="screen-scroll gift-screen">
        <div className="gift-screen__intro">
          <span>Коллекция</span>
          <strong>
            {loading
              ? 'Загружаем подарки'
              : items.length
                ? `${items.length} ${items.length === 1 ? 'подарок' : items.length < 5 ? 'подарка' : 'подарков'}`
                : 'Пока пусто'}
          </strong>
          <p>Сохраняйте тёплые моменты и добрые слова друзей.</p>
        </div>
        {loading ? (
          <StatePanel title="" loading />
        ) : items.length ? (
          <div className="gift-history-grid">
            {items.map((item) => {
              const senderName = item.sender?.display_name || 'Пользователь'
              const senderId = item.sender?.id || item.sender_user_id
              return (
                <article
                  className="gift-history-card"
                  data-gift-theme={giftTheme(item.item_code)}
                  key={item.id}
                >
                  <button
                    className="gift-history-card__sender"
                    type="button"
                    onClick={() => navigate('userprofile', senderId)}
                  >
                    <Avatar name={senderName} url={item.sender?.photo_url} size={30} />
                    <span className="gift-history-card__sender-name">{senderName}</span>
                    <Icon name="chevron" size={16} />
                  </button>
                  <button
                    className="gift-history-card__detail"
                    type="button"
                    onClick={() => setSelectedGift(item)}
                    aria-label={`Открыть подарок ${item.title}`}
                  >
                    <span className="gift-history-card__art">
                      <GiftArtwork code={item.item_code} size={110} />
                    </span>
                    <span className="gift-history-card__copy">
                      <strong>{item.title}</strong>
                      <span>{item.message || 'Без сообщения'}</span>
                      <small>
                        {new Intl.DateTimeFormat('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                        }).format(new Date(item.created_at))}
                      </small>
                    </span>
                  </button>
                </article>
              )
            })}
          </div>
        ) : (
          <StatePanel
            title="Подарков пока нет"
            description="Когда друг отправит подарок, он появится здесь."
          />
        )}
      </div>
      <div className="bottom-action">
        <Button onClick={() => navigate('sendgift', targetUserId)}>Подарить другу</Button>
      </div>
      {selectedGift && (
        <GiftDetailSheet
          gift={selectedGift}
          onClose={() => setSelectedGift(null)}
          onGiftAgain={() => {
            setSelectedGift(null)
            navigate('sendgift')
          }}
        />
      )}
    </>
  )
}
