import type { ComponentProps } from 'react'
import type { HostAdapter } from '../host'
import { PostActionsScreen } from '../screens/PostActionsScreen'
import { UserMenuScreen } from '../screens/UserMenuScreen'
import { Dialog, Icon } from '../ui/components/BasicUI'
import { ShareSheet } from '../ui/components/ShareSheet'
import type { AppDataResult } from '../useAppData'
import type { useFeedback } from './useFeedback'
import type { ActionMenu, useNavigation } from './useNavigation'
import type { useSharing } from './useSharing'

type Props = {
  actionMenu: ActionMenu
  closeMenu: () => void
  data: AppDataResult
  host: HostAdapter
  navigation: ReturnType<typeof useNavigation>
  sharing: ReturnType<typeof useSharing>
  feedback: ReturnType<typeof useFeedback>
  like: ComponentProps<typeof PostActionsScreen>['onLike']
  openMedia: ComponentProps<typeof PostActionsScreen>['openMedia']
}

export function OverlayHost({ actionMenu, closeMenu, data, host, navigation, sharing, feedback, like, openMedia }: Props) {
  const { navigate } = navigation
  const { sharePost, setSharePost, repost, shareNative, copyPostLink, shareToFriend } = sharing
  const { toast, modal, setModal, showError } = feedback
  return <>
    {actionMenu?.view === 'postactions' && (
      <PostActionsScreen
        id={actionMenu.id}
        anchor={actionMenu.anchor}
        back={() => closeMenu()}
        navigate={navigate}
        data={data}
        onLike={like}
        onError={showError}
        confirm={setModal}
        host={host}
        openMedia={openMedia}
      />
    )}
    {actionMenu?.view === 'usermenu' && (
      <UserMenuScreen
        id={actionMenu.id}
        anchor={actionMenu.anchor}
        back={() => closeMenu()}
        navigate={navigate}
        data={data}
        onLike={like}
        onError={showError}
        confirm={setModal}
        host={host}
        openMedia={openMedia}
      />
    )}
    {sharePost && (
      <ShareSheet
        post={sharePost}
        friends={data.friends}
        onClose={() => setSharePost(null)}
        onRepost={() => void repost(sharePost)}
        onShare={() => void shareNative(sharePost)}
        onCopy={() => void copyPostLink(sharePost)}
        onFriend={(userId) => void shareToFriend(sharePost, userId)}
      />
    )}
    {toast && (
      <div className="app-toast" role="status" aria-live="polite">
        <Icon name="check" size={18} />
        {toast}
      </div>
    )}
    {modal && (
      <Dialog
        title={modal.title}
        description={modal.description}
        confirm={modal.confirm}
        cancel={modal.cancel}
        destructive={modal.destructive}
        onConfirm={() => {
          const action = modal.onConfirm
          setModal(null)
          action()
        }}
        onClose={() => setModal(null)}
      />
    )}
  </>
}
