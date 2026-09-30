import { type Post } from '../../api/posts'
import { type Friend } from '../../api/users'
import { Avatar, Icon, IconButton } from './BasicUI'
import { useExpandableSheet } from './useExpandableSheet'

type Props = {
  post: Post
  friends: Friend[]
  onClose: () => void
  onRepost: () => void
  onShare: () => void
  onCopy: () => void
  onFriend: (userId: number) => void
}

export function ShareSheet({ post, friends, onClose, onRepost, onShare, onCopy, onFriend }: Props) {
  const { sheetRef, handleProps, expanded } = useExpandableSheet<HTMLElement>({ onClose })

  return (
    <div className="share-sheet-backdrop">
      <button
        className="sheet-backdrop-dismiss"
        type="button"
        tabIndex={-1}
        aria-label="Закрыть панель отправки"
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className="share-sheet"
        data-sheet-expanded={expanded}
        role="dialog"
        aria-modal="true"
        aria-label="Поделиться публикацией"
      >
        <button {...handleProps} />
        <div className="share-sheet__head">
          <div>
            <strong>Поделиться</strong>
            <span>{post.author.display_name}</span>
          </div>
          <IconButton icon="close" label="Закрыть" onClick={onClose} />
        </div>
        <div className="share-sheet__quick">
          <button type="button" onClick={onRepost} disabled={post.reposted_by_me}>
            <span>
              <Icon name="share" size={22} />
            </span>
            <strong>{post.reposted_by_me ? 'Уже на стене' : 'Репост'}</strong>
            <small>{post.reposted_by_me ? 'репост опубликован' : 'на свою стену'}</small>
          </button>
          <button type="button" onClick={onShare}>
            <span>
              <Icon name="send" size={22} />
            </span>
            <strong>MAX / TG</strong>
            <small>системный шеринг</small>
          </button>
          <button type="button" onClick={onCopy}>
            <span>
              <Icon name="link" size={22} />
            </span>
            <strong>Ссылка</strong>
            <small>скопировать</small>
          </button>
        </div>
        <h3>Отправить другу</h3>
        <div className="share-sheet__friends" data-sheet-scroll>
          {friends.length ? (
            friends.map((friend) => (
              <button
                className="share-sheet__friend"
                type="button"
                key={friend.user.id}
                onClick={() => onFriend(friend.user.id)}
              >
                <Avatar name={friend.user.display_name} url={friend.user.photo_url} size={44} />
                <span>
                  <strong>{friend.user.display_name}</strong>
                  <small>{friend.user.max_user_id ? 'MAX' : 'Открыть системный шеринг'}</small>
                </span>
                <Icon name="message" size={22} />
              </button>
            ))
          ) : (
            <p className="share-sheet__empty">
              Добавьте друзей — они появятся здесь для быстрой отправки.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
