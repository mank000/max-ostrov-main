import { useEffect } from 'react'
import { realtimeURL } from './api/credentials'
import { startPostRefresh } from './data/postRefresh'
import { postChanged, publishPosts, syncPosts } from './data/postSync'
import type { AppDataKey } from './useAppData'

const postEvents = ['post.created', 'post.updated', 'post.deleted', 'post.comment_created', 'post.comment_updated', 'post.comment_deleted']

function eventPayload(event: MessageEvent) {
  try {
    const value = JSON.parse(event.data)?.payload
    if (!value || typeof value !== 'object') return {}
    return {
      postId: Number.isSafeInteger(value.post_id) && value.post_id > 0 ? value.post_id as number : undefined,
      commentId: Number.isSafeInteger(value.comment_id) && value.comment_id > 0 ? value.comment_id as number : undefined,
    }
  } catch { return {} }
}

export function useRealtimeRefresh(authenticated: boolean, refresh: (...domains: AppDataKey[]) => void, socialEnabled = true, clipsEnabled = false) {
  useEffect(() => {
    if (!authenticated) return
    const contentEnabled = socialEnabled || clipsEnabled
    const posts = contentEnabled ? startPostRefresh() : null
    const datingChanged = () => window.dispatchEvent(new Event('kutezh:dating-updated'))
    let source: EventSource | null = null
    let reconnectTimer = 0
    let refreshTimer = 0
    let retryDelay = 1000
    let stopped = false
    let connectedOnce = false
    let lastHeadRefresh = Date.now()
    const domains = new Set<AppDataKey>()
    const active = () => !stopped && !document.hidden && navigator.onLine
    const scheduleRefresh = (...keys: AppDataKey[]) => {
      for (const key of keys) domains.add(key)
      if (refreshTimer) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = 0
        if (!active()) return
        refresh(...domains)
        domains.clear()
      }, 250)
    }
    const resync = () => {
      datingChanged()
      if (clipsEnabled) { syncPosts(); window.dispatchEvent(new Event('kutezh:clips-updated')); scheduleRefresh('inbox') }
      if (!socialEnabled) return
      syncPosts()
      postChanged({ type: 'resync' })
      scheduleRefresh('feed', 'profilePosts', 'friends', 'activity', 'recommendations', 'inbox')
      lastHeadRefresh = Date.now()
    }
    const onPost = (event: MessageEvent) => {
      const change = { type: event.type, ...eventPayload(event) }
      if (change.type === 'post.deleted' && change.postId) publishPosts([], [change.postId])
      else if (change.postId) syncPosts([change.postId])
      else syncPosts()
      if (change.type === 'post.created' && socialEnabled) {
        scheduleRefresh('feed', 'profilePosts')
        lastHeadRefresh = Date.now()
      }
      postChanged(change)
    }
    const connect = () => {
      if (!active() || source || typeof EventSource === 'undefined') return
      const stream = new EventSource(realtimeURL())
      source = stream
      stream.addEventListener('ready', () => {
        if (source !== stream) return
        retryDelay = 1000
        if (connectedOnce) resync()
        connectedOnce = true
        if (socialEnabled) syncPosts()
      })
      stream.addEventListener('sync.required', resync)
      stream.addEventListener('wallet.updated', () => { window.dispatchEvent(new Event('kutezh:wallet-updated')); scheduleRefresh('profile', 'activity') })
      stream.addEventListener('profile.verification_updated', () => { scheduleRefresh('profile'); datingChanged() })
      const clipChanged = (detail: {
        shared?: boolean
        reacted?: boolean
        deleted?: boolean
      }) => {
        window.dispatchEvent(new CustomEvent('kutezh:clips-updated', { detail }))
        scheduleRefresh('inbox')
      }
      stream.addEventListener('clip.shared', () => clipChanged({ shared: true }))
      stream.addEventListener('clip.reacted', () => clipChanged({ reacted: true }))
      stream.addEventListener('clip.message_deleted', () =>
        clipChanged({ deleted: true }),
      )
      stream.addEventListener('dating.updated', () => { datingChanged(); if (socialEnabled) scheduleRefresh('friends', 'inbox') })
      for (const type of ['attendance.updated', 'achievement.unlocked', 'gift.received', 'organizer.reviewed'])
        stream.addEventListener(type, () => scheduleRefresh('profile', 'activity', 'inbox'))
      if (contentEnabled)
        for (const type of postEvents) stream.addEventListener(type, onPost as EventListener)
      stream.addEventListener('notification.created', (event) => {
        scheduleRefresh('inbox')
        if (socialEnabled) scheduleRefresh('friends', 'activity')
        const { postId } = eventPayload(event as MessageEvent)
        if (postId && contentEnabled) {
          syncPosts([postId])
          postChanged({ type: 'post.notification', postId })
        }
      })
      stream.onerror = () => {
        if (source !== stream) return
        stream.close()
        source = null
        window.clearTimeout(reconnectTimer)
        if (!active()) return
        reconnectTimer = window.setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30000)
      }
    }
    const pause = () => {
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(refreshTimer)
      refreshTimer = 0
      source?.close()
      source = null
      posts?.pause()
    }
    const resume = () => {
      if (!active()) {
        pause()
        return
      }
      resync()
      connect()
    }
    const poll = window.setInterval(() => {
      if (!active()) return
      if (typeof EventSource !== 'undefined' && source?.readyState === EventSource.OPEN) return
      if (socialEnabled) {
        syncPosts()
        postChanged({ type: 'poll' })
        if (Date.now() - lastHeadRefresh >= 60000) {
          scheduleRefresh('feed', 'profilePosts')
          lastHeadRefresh = Date.now()
        }
      }
      scheduleRefresh('inbox')
      connect()
    }, 20000)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    window.addEventListener('offline', pause)
    window.addEventListener('pageshow', resume)
    window.addEventListener('pagehide', pause)
    connect()
    return () => {
      stopped = true
      pause()
      posts?.stop()
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', pause)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('pagehide', pause)
    }
  }, [authenticated, refresh, socialEnabled, clipsEnabled])
}
