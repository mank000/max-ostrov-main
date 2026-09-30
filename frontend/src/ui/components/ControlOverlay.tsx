import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './controls.css'

export type ControlAnchor = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>

/** Native modal semantics, with our own surface and controls on every platform. */
export function ControlOverlay({
  title,
  onClose,
  children,
  anchor,
  className = '',
  id,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  anchor?: ControlAnchor
  className?: string
  id?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current!
    // Safari does not focus buttons on pointer activation. Remember the anchor
    // explicitly so dismissing a picker still returns keyboard focus to its field.
    const trigger =
      anchor &&
      document
        .elementFromPoint((anchor.left + anchor.right) / 2, (anchor.top + anchor.bottom) / 2)
        ?.closest<HTMLElement>('button, input, [tabindex]')
    const previous = trigger || (document.activeElement as HTMLElement | null)
    const keyboardOpened = previous?.matches(':focus-visible') ?? false
    dialog.showModal()
    const position = () => {
      const viewport = window.visualViewport
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const top = viewport?.offsetTop ?? 0
      const left = viewport?.offsetLeft ?? 0
      const mobile = width < 640
      dialog.style.maxHeight = `${Math.max(120, height - 24)}px`
      dialog.style.width = `${Math.min(mobile ? 480 : 360, width - 24)}px`
      const rect = dialog.getBoundingClientRect()
      dialog.style.left = `${mobile || !anchor ? left + (width - rect.width) / 2 : Math.max(left + 12, Math.min(anchor.left, left + width - rect.width - 12))}px`
      dialog.style.top = `${mobile ? top + height - rect.height - 12 : anchor ? Math.max(top + 12, Math.min(anchor.bottom + 8, top + height - rect.height - 12)) : top + (height - rect.height) / 2}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(dialog)
    window.addEventListener('resize', position)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    if (keyboardOpened) {
      const initial = dialog.querySelector<HTMLElement>(
        '[data-initial-focus], [aria-selected="true"], [aria-checked="true"], [role="menuitem"]:not(:disabled)',
      )
      initial?.focus({ preventScroll: true })
      initial?.scrollIntoView({ block: 'nearest' })
    } else {
      // Native dialogs focus their first control automatically. On touch/mouse that
      // looks like a stray blue selection ring, so keep neutral focus on the surface.
      dialog.focus({ preventScroll: true })
    }
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
      const keyboardFocusedInside =
        document.activeElement instanceof HTMLElement &&
        dialog.contains(document.activeElement) &&
        document.activeElement.matches(':focus-visible')
      dialog.close()
      if ((keyboardOpened || keyboardFocusedInside) && previous?.isConnected)
        previous.focus({ preventScroll: true })
    }
  }, [anchor])

  return createPortal(
    <dialog
      ref={ref}
      tabIndex={-1}
      id={id}
      className={`control-overlay ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose()
      }}
    >
      <header className="control-overlay__header">
        <h2>{title}</h2>
        <button
          type="button"
          className="control-icon-button"
          aria-label="Закрыть"
          onClick={onClose}
        >
          <ControlIcon name="close" />
        </button>
      </header>
      <div className="control-overlay__body">{children}</div>
    </dialog>,
    document.body,
  )
}

export function ControlIcon({
  name,
}: {
  name: 'check' | 'chevron' | 'calendar' | 'close' | 'back'
}) {
  const paths = {
    check: 'm5 12 4 4L19 6',
    chevron: 'm8 5 7 7-7 7',
    back: 'm15 5-7 7 7 7',
    close: 'm6 6 12 12M6 18 18 6',
    calendar:
      'M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  }
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
