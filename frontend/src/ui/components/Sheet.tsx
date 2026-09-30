import { useEffect, type ReactNode } from 'react'
import { Icon } from './BasicUI'
import { useExpandableSheet } from './useExpandableSheet'
import './sheet.css'
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const {
    sheetRef: dialog,
    handleProps,
    expanded,
  } = useExpandableSheet<HTMLDialogElement>({ onClose })
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    const previous = document.activeElement as HTMLElement | null
    const keyboardOpened = previous?.matches(':focus-visible') ?? false
    d.showModal()
    if (!keyboardOpened) d.focus({ preventScroll: true })
    return () => d.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className="ui-sheet"
      data-sheet-expanded={expanded}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ui-sheet-body">
        <button {...handleProps} />
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </header>
        <div className="ui-sheet-scroll" data-sheet-scroll>
          {children}
        </div>
      </div>
    </dialog>
  )
}
