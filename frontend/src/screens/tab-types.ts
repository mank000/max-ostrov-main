import type { MenuAnchor } from '../ui/components/ContextMenu'

export type Navigate = (view: string, id?: number, anchor?: MenuAnchor) => void
export type Confirm = (config: {
  title: string
  description?: string
  confirm: string
  onConfirm: () => void
  destructive?: boolean
}) => void
