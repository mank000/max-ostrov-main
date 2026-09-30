import { useEffect, useRef, useState } from 'react'
import { request } from '../../api/http'
import { Avatar, Icon } from './BasicUI'

type Reaction = { count: number; liked: boolean; users: { id: number; display_name: string; photo_url: string }[]; next?: number }
export function AvatarLikes({ owner, media }: { owner: number; media: number }) {
  const [data, setData] = useState<Reaction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const path = `/avatar-likes/${owner}/${media}`
  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      if (document.hidden) return
      void request<Reaction>(path, { signal: controller.signal }).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    }
    load()
    document.addEventListener('visibilitychange', load)
    return () => { controller.abort(); document.removeEventListener('visibilitychange', load) }
  }, [path])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const node = dialog.current!
    node.showModal()
    return () => { node.close(); previous?.focus() }
  }, [open])
  async function change() {
    if (busy || !data) return
    setBusy(true); setError('')
    try { setData(await request<Reaction>(path, { method: data.liked ? 'DELETE' : 'PUT' })) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function more() {
    if (!data?.next || busy) return
    setBusy(true); setError('')
    try { const page = await request<Reaction>(`${path}?after=${data.next}`); setData(old => ({ ...page, users: [...(old?.users || []), ...page.users] })) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="avatar-reactions">
    <button type="button" disabled={busy || !data} aria-pressed={data?.liked || false} aria-label={data?.liked ? 'Убрать лайк аватарки' : 'Лайк аватарки'} onClick={() => void change()}><Icon name="heart" size={25} /></button>
    <button type="button" disabled={!data} aria-label="Кому понравилась аватарка" onClick={() => setOpen(true)}>{data?.count ?? '…'}</button>
    {error && !open && <span role="alert">{error}</span>}
    {open && <dialog onKeyDown={event => event.stopPropagation()} className="avatar-likes-dialog" ref={dialog} aria-label="Кому понравилось" onCancel={e => { e.preventDefault(); setOpen(false) }}>
      <header><h2>Кому понравилось</h2><button type="button" aria-label="Закрыть список лайков" onClick={() => setOpen(false)}><Icon name="close" /></button></header>
      <div className="avatar-likes-list">{data?.users.length ? data.users.map(user => <div key={user.id}><Avatar name={user.display_name} url={user.photo_url} size={40} /><span>{user.display_name}</span></div>) : <p>Пока нет лайков</p>}</div>
      {data?.next && <button type="button" disabled={busy} onClick={() => void more()}>Показать ещё</button>}
      {error && <p role="alert">{error}</p>}
    </dialog>}
  </div>
}
