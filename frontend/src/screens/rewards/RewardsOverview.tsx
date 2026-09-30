import { useEffect, useState } from 'react'
import { loadRewards, type Achievement } from '../../api/rewards'
import { Header, Icon, StatePanel } from '../../ui/components/BasicUI'
import type { ScreenProps } from '../screen-types'
import { maxLink } from '../../ui-utils'

export function AchievementCard({ item }: { item: Achievement }) {
  const complete = Boolean(item.unlocked_at)
  const progress = Math.min(item.target, Math.max(0, item.progress))
  const percent = item.target > 0 ? (progress / item.target) * 100 : 0
  return (
    <article className={`achievement-card ${complete ? 'is-complete' : ''}`}>
      <span className="achievement-card__icon">
        <Icon name={complete ? 'check' : 'award'} size={23} />
      </span>
      <div className="achievement-card__body">
        <div className="achievement-card__head">
          <strong>{item.title}</strong>
          <span>{complete ? 'Получено' : `+${item.reward_coins} монет`}</span>
        </div>
        <p>{item.description}</p>
        <div className="achievement-card__progress">
          <span style={{ width: `${percent}%` }} />
        </div>
        <small>
          {complete ? `Награда: +${item.reward_coins} монет` : `${progress} из ${item.target}`}
        </small>
      </div>
    </article>
  )
}

export function Rewards({ back, navigate, onError, data, host, maxBotName }: ScreenProps) {
  const [unlimited, setUnlimited] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    loadRewards(controller.signal)
      .then((value) => {
        setBalance(value.balance)
        setUnlimited(value.unlimited)
        setAchievements(value.achievements)
      })
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [onError])
  const active = achievements.filter((item) => !item.unlocked_at)
  const complete = achievements.filter((item) => item.unlocked_at)
  const referralLink = data.profile?.id ? maxLink(maxBotName, `ref_${data.profile.id}`) : null
  const inviteFriend = async () => {
    if (!referralLink) {
      onError('Ссылка приглашения пока недоступна')
      return
    }
    const text = 'Присоединяйся к Кутёжу: по моей ссылке тебе дадут 50 монет, а мне — 150.'
    try {
      if (await host.share({ text, link: referralLink })) return
    } catch {
      // Fall back to copying the invite below.
    }
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(`${text}\n${referralLink}`)
      setInviteCopied(true)
    } catch {
      onError('Не удалось поделиться ссылкой приглашения')
    }
  }
  return (
    <>
      <Header title="Монеты и достижения" back={back} />
      <div className="screen-scroll economy-screen">
        <section className="economy-hero">
          <div className="economy-hero__balance">
            <span className="economy-hero__coin">
              <Icon name="coins" size={32} />
            </span>
            <span>
              <small>Ваш баланс</small>
              <strong>
                {unlimited ? '∞' : balance ?? '—'} <em>монет</em>
              </strong>
            </span>
          </div>
          <p>Монеты приходят за встречи, достижения и игры. Ими можно радовать друзей подарками.</p>
          <div className="economy-hero__links">
            <button type="button" onClick={() => navigate('sendgift')}>
              Выбрать подарок <Icon name="chevron" size={17} />
            </button>
            <button type="button" onClick={() => navigate('transactions')}>
              История <Icon name="chevron" size={17} />
            </button>
          </div>
        </section>
        <section className="economy-referral" aria-label="Реферальная программа">
          <span className="economy-referral__icon">
            <Icon name="users" size={23} />
          </span>
          <div className="economy-referral__body">
            <strong>Приглашайте друзей</strong>
            <p><b>+150</b> монет вам за каждого нового друга, <b>+50</b> монет — другу.</p>
          </div>
          <button type="button" onClick={() => void inviteFriend()}>
            {inviteCopied ? 'Ссылка скопирована' : 'Пригласить'}
          </button>
        </section>
        <button className="economy-store-link" type="button" onClick={() => navigate('store')}>
          <span>
            <Icon name="star" size={22} />
          </span>
          <span>
            <strong>Магазин</strong>
            <small>Продвижение мероприятий и другие возможности</small>
          </span>
          <Icon name="chevron" size={20} />
        </button>
        {loading ? (
          <StatePanel title="" loading />
        ) : achievements.length ? (
          <>
            {active.length > 0 && (
              <section className="achievement-section">
                <h2>
                  В процессе <span>{active.length}</span>
                </h2>
                <div className="achievement-list">
                  {active.map((item) => (
                    <AchievementCard key={item.code} item={item} />
                  ))}
                </div>
              </section>
            )}
            {complete.length > 0 && (
              <section className="achievement-section">
                <h2>
                  Получено <span>{complete.length}</span>
                </h2>
                <div className="achievement-list">
                  {complete.map((item) => (
                    <AchievementCard key={item.code} item={item} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <StatePanel title="Пока нет достижений" />
        )}
      </div>
    </>
  )
}
