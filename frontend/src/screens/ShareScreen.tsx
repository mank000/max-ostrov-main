import { useEffect, useState } from 'react'
import { loadPost, type Post } from '../api/posts'
import { loadFriendDirectMessageTarget } from '../api/users'
import { usePostUpdate } from '../data/usePostUpdates'
import { maxLink } from '../ui-utils'
import { Cell, Header, StatePanel } from '../ui/components/BasicUI'
import './extras.css'
import type { ScreenProps } from './screen-types'

export function ShareScreen({
  route,
  data,
  back,
  navigate,
  host,
  onError,
  confirm,
  maxBotName,
}: ScreenProps) {
  const cachedPost = [...data.posts, ...data.profilePosts].find(
    (item) => item.id === route.id,
  )
  const [loadedPost, setLoadedPost] = useState<Post | null>(cachedPost || null)
  usePostUpdate(loadedPost, setLoadedPost)
  const post = cachedPost || loadedPost
  useEffect(() => {
    if (!route.id || cachedPost) return
    const controller = new AbortController()
    loadPost(route.id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setLoadedPost(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) onError(String(error))
      })
    return () => controller.abort()
  }, [route.id, cachedPost, onError])
  const payload = `post_${route.id}`
  const url =
    host.provider === 'max'
      ? maxLink(maxBotName, payload) ||
        `${window.location.origin}/?postId=${route.id}`
      : `${window.location.origin}/?postId=${route.id}`
  async function send() {
    if (!post) return
    try {
      const sent = await host.share({ link: url })
      if (!sent && navigator.share) await navigator.share({ url })
      else if (!sent) await navigator.clipboard.writeText(url)
    } catch (error) {
      onError(String(error))
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      confirm({
        title: 'Ссылка скопирована',
        confirm: 'Готово',
        onConfirm: () => confirm(null),
      })
    } catch (error) {
      onError(String(error))
    }
  }
  return (
    <>
      <Header title="Поделиться" back={back} />
      <div className="screen-scroll">
        <h2 className="section-title">Отправьте публикацию друзьям</h2>
        <Cell
          icon="send"
          title={host.provider === 'max' ? 'Отправить в MAX' : 'Поделиться'}
          detail="Откроется системное меню"
          onClick={() => void send()}
        />
        <Cell
          icon="link"
          title="Скопировать ссылку"
          detail="Ссылка на публикацию"
          onClick={() => void copy()}
        />
        {post?.event_id && (
          <Cell
            icon="users"
            title="Пригласить на мероприятие"
            onClick={() => navigate('eventinvites', post.event_id)}
          />
        )}
      </div>
    </>
  )
}

export function HostMessage({ route, back, host, onError }: ScreenProps) {
  const [chatId, setChatId] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!route.id) return
    const controller = new AbortController()
    loadFriendDirectMessageTarget(route.id, controller.signal)
      .then((target) => {
        if (!controller.signal.aborted) {
          setChatId(target.max_chat_id || '')
          setFailed(!target.max_chat_id)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true)
          onError(String(error))
        }
      })
    return () => controller.abort()
  }, [route.id, onError])
  return (
    <>
      <Header title="Сообщение" back={back} />
      <StatePanel
        title={
          failed
            ? 'Диалог недоступен'
            : chatId
              ? 'Личный диалог в MAX'
              : 'Загружаем диалог'
        }
        loading={!chatId && !failed}
        action={chatId ? 'Открыть диалог' : undefined}
        onAction={
          chatId
            ? () => {
                if (!host.openChat(chatId)) onError('Не удалось открыть чат')
              }
            : undefined
        }
      />
    </>
  )
}
