import type { ReactNode } from 'react'
import { ControlOverlay } from '../../../frontend/src/ui/components/ControlOverlay'

export function Dialog({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <ControlOverlay title={label} onClose={onClose}>
      <div className="dating-dialog-content">{children}</div>
    </ControlOverlay>
  )
}
