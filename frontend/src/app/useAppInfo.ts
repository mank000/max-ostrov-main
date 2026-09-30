import { useEffect, useState } from 'react'
import { loadAppInfo } from '../api/auth'

export function useAppInfo() {
  const [botName, setBotName] = useState(() => import.meta.env.VITE_MAX_BOT_NAME || '')
  const [demoMode, setDemoMode] = useState(false)
  const [moderationURL, setModerationURL] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void loadAppInfo(controller.signal).then((info) => {
      if (controller.signal.aborted) return
      setDemoMode(info.demo_mode === true)
      setModerationURL(info.moderation_url || '')
      if (info.max_bot_username) setBotName(info.max_bot_username)
    }).catch(() => {
      // Метаданные для ссылок не должны мешать уже открытой сессии.
    })
    return () => controller.abort()
  }, [])
  return { botName, demoMode, moderationURL }
}
