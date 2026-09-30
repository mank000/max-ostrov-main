import { type Event } from '../api/events'
import { type Post, type PostMedia } from '../api/posts'
import type { HostAdapter } from '../host'
import { type CityPin } from '../ui-utils'
import type { AppDataResult } from '../useAppData'

export type ScreenProps = {
  route: { view: string; id?: number }
  active: boolean
  data: AppDataResult
  city: string
  cityPin: CityPin | null
  setCityPin: (city: CityPin | null) => void
  theme: 'light' | 'dark'
  themeMode: 'auto' | 'light' | 'dark'
  setTheme: (theme: 'auto' | 'light' | 'dark') => void
  maxBotName: string
  navigate: (view: string, id?: number) => void
  openClip?: (clipId: number, comments?: boolean) => void
  back: () => void
  openMedia: (media: PostMedia | string, items?: PostMedia[]) => void
  onLike: (post: Post) => Promise<boolean>
  onError: (description: string) => void
  confirm: (
    modal: {
      title: string
      description?: string
      confirm: string
      onConfirm: () => void
      destructive?: boolean
    } | null,
  ) => void
  host: HostAdapter
  event?: Event
  loadEvent: (id: number, signal?: AbortSignal) => Promise<Event>
  onEventUpdated: (event: Event) => void
  onEventDeleted: (eventId: number) => void
}
