import { useEffect, useState } from 'react'
import { loadRewards, sendGift } from '../../api/rewards'
import { loadAllFriends, searchUsers, type UserSearchResult } from '../../api/users'
import { Button, Cell, Header, Icon, SearchField, StatePanel } from '../../ui/components/BasicUI'
import { PersonRow } from '../../ui/components/ContentCards'
import { GiftArtwork } from '../../ui/components/GiftArtwork'
import type { ScreenProps } from '../screen-types'
import { GIFT_THEMES, type GiftTheme, ILLUSTRATED_GIFT_CODES, giftTheme } from './giftThemes'
import { useStore } from './useStore'

const MESSAGE_CHARACTER_LIMIT = 120

export function SendGift({ route, back, navigate, onError, confirm, data }: ScreenProps) {
  const items = useStore(onError).filter((item) => item.kind === 'gift')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const trimmedMessage = message.trim()
  const messageCharacters = Array.from(trimmedMessage).length
  const messageTooLong = messageCharacters > MESSAGE_CHARACTER_LIMIT
  const [userId, setUserId] = useState(route.id || 0)
  const [recipient, setRecipient] = useState(() =>
    route.id
      ? data.friends.find((friend) => friend.user.id === route.id)?.user.display_name || ''
      : '',
  )
  useEffect(() => {
    if (!userId || recipient) return
    const friend = data.friends.find((item) => item.user.id === userId)
    if (friend) setRecipient(friend.user.display_name)
  }, [data.friends, recipient, userId])
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<UserSearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState<GiftTheme>('all')
  const [unlimited, setUnlimited] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const selected = items.find((item) => item.code === code)
  const visibleItems =
    theme === 'all'
      ? [...items].sort(
        (a, b) =>
          Number(ILLUSTRATED_GIFT_CODES.has(b.code)) - Number(ILLUSTRATED_GIFT_CODES.has(a.code)),
      )
      : items.filter((item) => giftTheme(item.code) === theme)
  const canAfford = unlimited || !selected || balance === null || balance >= selected.coin_price

  useEffect(() => {
    const controller = new AbortController()
    loadRewards(controller.signal)
      .then((value) => { setBalance(value.balance); setUnlimited(value.unlimited) })
      .catch(() => { })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    if (picker) {
      const request = query.trim()
        ? searchUsers(query, controller.signal)
        : loadAllFriends(controller.signal).then((friends) =>
          friends.map((friend) => ({
            ...friend.user,
            bio: '',
            interests: [],
          })),
        )
      request.then(setPeople).catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    }
    return () => controller.abort()
  }, [picker, query, onError])

  async function submit() {
    if (!userId || !code || !canAfford || messageTooLong || busy) return
    setBusy(true)
    try {
      await sendGift(userId, code, trimmedMessage)
      confirm({
        title: 'Подарок отправлен',
        description: selected?.title,
        confirm: 'Готово',
        onConfirm: () => navigate('gifts'),
      })
    } catch (error) {
      onError(String(error))
    } finally {
      setBusy(false)
    }
  }

  if (picker)
    return (
      <>
        <Header title="Выберите друга" back={() => setPicker(false)} />
        <div className="screen-scroll">
          <div className="extra-pad">
            <SearchField value={query} onChange={setQuery} placeholder="Имя или @username" />
          </div>
          {people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              onClick={() => {
                setUserId(person.id)
                setRecipient(person.display_name)
                setPicker(false)
              }}
            />
          ))}
        </div>
      </>
    )

  return (
    <>
      <Header title="Подарок другу" back={back} />
      <div className="screen-scroll gift-compose">
        <div className="gift-compose__wallet">
          <span>
            <Icon name="coins" size={19} /> Ваш баланс
          </span>
          <strong>{unlimited ? '∞' : balance === null ? '—' : balance} монет</strong>
        </div>
        <div className="gift-compose__recipient">
          <Cell
            icon="user"
            title="Получатель"
            detail={recipient || (userId ? 'Выбран пользователь' : 'Выберите друга')}
            onClick={() => setPicker(true)}
          />
        </div>
        <div className="gift-compose__message">
          <label htmlFor="gift-message">Сообщение <span>· необязательно</span></label>
          <textarea
            id="gift-message"
            rows={2}
            placeholder="Пара тёплых слов…"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            aria-describedby="gift-message-counter"
            aria-invalid={messageTooLong}
          />
          <div id="gift-message-counter" className="gift-compose__message-counter" data-invalid={messageTooLong}>
            <span>{messageCharacters}/{MESSAGE_CHARACTER_LIMIT} символов</span>
            {messageTooLong && <strong role="status">Сократите текст</strong>}
          </div>
        </div>
        <div className="gift-compose__heading">
          <h2>Выберите подарок</h2>
          <span>{items.length ? `${items.length} вариантов` : 'Загрузка…'}</span>
        </div>
        <fieldset className="gift-theme-tabs">
          <legend className="gift-theme-tabs__label">Темы подарков</legend>
          {GIFT_THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={theme === option.id}
              className={theme === option.id ? 'is-active' : ''}
              onClick={() => setTheme(option.id)}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        {items.length ? (
          <div className="gift-picker-grid">
            {visibleItems.map((item) => (
              <button
                key={item.code}
                className={`gift-picker-card ${code === item.code ? 'is-selected' : ''}`}
                data-gift-theme={giftTheme(item.code)}
                type="button"
                aria-pressed={code === item.code}
                onClick={() => setCode(item.code)}
              >
                <span className="gift-picker-card__art">
                  <GiftArtwork code={item.code} size={106} />
                </span>
                <strong>{item.title}</strong>
                <small>
                  <Icon name="coins" size={15} /> {item.coin_price}
                </small>
                {code === item.code && (
                  <span className="gift-picker-card__check">
                    <Icon name="check" size={14} />
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <StatePanel title="Подарки загружаются" loading />
        )}
        {selected && (
          <div className="gift-selection-summary" data-gift-theme={giftTheme(selected.code)}>
            <GiftArtwork code={selected.code} size={78} />
            <span>
              <strong>{selected.title}</strong>
              <small>{selected.description}</small>
            </span>
          </div>
        )}
        {selected && !canAfford && (
          <div className="gift-compose__shortage">
            <span>Не хватает {selected.coin_price - (balance || 0)} монет для этого подарка.</span>
            <button type="button" onClick={() => navigate('rewards')}>
              Как получить монеты <Icon name="chevron" size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="bottom-action">
        <Button disabled={!userId || !code || !canAfford || messageTooLong || busy} onClick={() => void submit()}>
          {busy
            ? 'Отправляем…'
            : selected
              ? `Отправить · ${selected.coin_price} монет`
              : 'Выберите подарок'}
        </Button>
      </div>
    </>
  )
}
