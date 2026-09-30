import { useSyncExternalStore } from 'react'
import { preparePhotoFile } from '../api/media'
import { verifyFace, type Profile } from '../api/users'
const pending = new Set<number>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useVerificationBusy(id?: number) {
  return useSyncExternalStore(subscribe, () => id !== undefined && pending.has(id))
}
export async function runFaceVerification(id: number, file: File, apply: (profile: Profile) => void, onError: (message: string) => void) {
  if (pending.has(id)) return false
  pending.add(id); notify()
  try {
    const result = await verifyFace(await preparePhotoFile(file))
    apply(result.profile)
    return true
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error))
    return false
  } finally {
    pending.delete(id); notify()
  }
}
