import { useState } from 'react'
import { adminAction } from '../api/admin'
import { reportUser } from '../api/reports'
import { setBlocked } from '../api/users'
import { Button, Field } from '../ui/components/BasicUI'
import {
  MaxContextMenu,
  MaxContextMenuItem,
} from '../ui/components/ContextMenu'
import type { SocialProps } from './FriendPages'
import './social.css'

export function UserMenuScreen({
  id,
  anchor,
  back,
  navigate,
  onError,
  confirm,
  data,
  host,
}: SocialProps) {
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  function block() {
    if (!id) return
    back()
    confirm({
      title: 'Заблокировать пользователя?',
      description:
        'Он не сможет находить вас и взаимодействовать с вашим профилем.',
      confirm: 'Заблокировать',
      destructive: true,
      onConfirm: () => {
        void setBlocked(id, true).catch((error) => onError(String(error)))
      },
    })
  }
  async function report() {
    if (!id || !reason.trim() || sending) return
    setSending(true)
    try {
      await reportUser(id, reason.trim())
      back()
      confirm({
        title: 'Жалоба отправлена',
        description: 'Мы получили вашу жалобу.',
        confirm: 'Готово',
        onConfirm: () => {},
      })
    } catch (error) {
      onError(String(error))
    } finally {
      setSending(false)
    }
  }
  return (
    <MaxContextMenu anchor={anchor} label="Действия с профилем" onClose={back}>
      {!reporting ? (
        <>
          <MaxContextMenuItem
            icon="comment"
            label="Написать сообщение"
            onClick={() => {
              back()
              const chatId = data.friends.find((item) => item.user.id === id)
                ?.user.max_chat_id
              if (!chatId || !host.openChat(chatId)) navigate('hostmessage', id)
            }}
          />
          {data.profile?.moderation_role === 'administrator' &&
            !!id &&
            id !== data.profile.id && (
              <MaxContextMenuItem
                icon="lock"
                label="Заблокировать в приложении"
                destructive
                onClick={() => {
                  back()
                  confirm({
                    title: 'Заблокировать в приложении?',
                    description:
                      'Пользователь потеряет доступ. Разблокировка доступна в админ-разделе.',
                    confirm: 'Заблокировать',
                    destructive: true,
                    onConfirm: () => {
                      void adminAction(
                        'user',
                        id!,
                        'suspend',
                        'Блокировка администратором из профиля',
                      )
                        .then(() => {
                          data.refresh('feed', 'friends')
                          navigate('admin')
                        })
                        .catch((error) => onError(String(error)))
                    },
                  })
                }}
              />
            )}
          <MaxContextMenuItem
            icon="lock"
            label="Заблокировать"
            destructive
            onClick={block}
          />
          <MaxContextMenuItem
            icon="info"
            label="Пожаловаться"
            destructive
            onClick={() => setReporting(true)}
          />
        </>
      ) : (
        <form
          className="max-context-menu__form"
          onSubmit={(event) => {
            event.preventDefault()
            void report()
          }}
        >
          <h3>Жалоба на профиль</h3>
          <p>Опишите причину жалобы.</p>
          <Field
            label="Причина"
            value={reason}
            onChange={(value) => setReason(value.slice(0, 500))}
            placeholder="Что не так?"
            multiline
          />
          <div className="max-context-menu__form-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setReporting(false)
                setReason('')
              }}
              disabled={sending}
            >
              Назад
            </Button>
            <Button
              type="submit"
              disabled={reason.trim().length < 3 || sending}
            >
              {sending ? 'Отправляем…' : 'Отправить'}
            </Button>
          </div>
        </form>
      )}
    </MaxContextMenu>
  )
}
