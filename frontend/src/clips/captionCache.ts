export type CaptionReturnCache = {
  clipId: number
  feedScrollTop: number
  buttonTop: number
  windowScrollY: number
}

export function captionReturnKey(clipId: number): string {
  return `clips:caption-return:${clipId}`
}

export function parseCaptionReturn(raw: string | null, clipId: number): CaptionReturnCache | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const cache = value as Record<string, unknown>
    if (cache.clipId !== clipId || !Number.isSafeInteger(clipId) || clipId <= 0) return null
    // В sessionStorage мог остаться старый формат. NaN и строки нельзя отдавать scrollTo.
    for (const key of ['feedScrollTop', 'buttonTop', 'windowScrollY']) {
      if (typeof cache[key] !== 'number' || !Number.isFinite(cache[key])) return null
    }
    if ((cache.feedScrollTop as number) < 0 || (cache.windowScrollY as number) < 0) return null
    return { clipId, feedScrollTop: cache.feedScrollTop as number,
      buttonTop: cache.buttonTop as number, windowScrollY: cache.windowScrollY as number }
  } catch {
    return null
  }
}
