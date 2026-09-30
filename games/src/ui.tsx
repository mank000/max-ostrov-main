import { useEffect, useRef, type ReactNode } from 'react'

const icons = import.meta.glob('./assets/icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  const mask = `url("${icons[`./assets/icons/${name}.svg`]}")`
  return <span className="icon" aria-hidden="true" style={{ width: size, height: size, maskImage: mask, WebkitMaskImage: mask }} />
}

export function Button({ children, onClick, secondary = false }: { children: ReactNode; onClick: () => void; secondary?: boolean }) {
  return <button type="button" className={`button ${secondary ? 'button--secondary' : ''}`} onClick={onClick}>{children}</button>
}

export function Back() {
  return <span className="dots" aria-hidden="true"><i /><i /><i /><i /></span>
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = ref.current!
    const focus = document.activeElement as HTMLElement | null
    node.showModal()
    return () => { node.close(); focus?.focus() }
  }, [])
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <h2 id="dialog-title">{title}</h2>
    {children}
  </dialog>
}
