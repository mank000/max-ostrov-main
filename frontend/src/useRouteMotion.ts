import { useLayoutEffect, type RefObject } from 'react'
import { BACK_PARALLAX } from './useBackGesture'

export type RouteMotion = 'tab' | 'push' | 'pop'

export function reduceMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

type Options = {
  view: string
  id?: number
  motion: RouteMotion
  mapHostRef: RefObject<HTMLDivElement | null>
  routeAnimations: RefObject<Animation[]>
  skipNextRouteMotion: RefObject<boolean>
  cancelRouteAnimations: () => void
  getMotionLayers: () => { current: HTMLElement | null; previousVisuals: HTMLElement[] }
}

export function useRouteMotion({
  view,
  id,
  motion,
  mapHostRef,
  routeAnimations,
  skipNextRouteMotion,
  cancelRouteAnimations,
  getMotionLayers,
}: Options) {
  useLayoutEffect(() => {
    cancelRouteAnimations()
    if (skipNextRouteMotion.current) {
      skipNextRouteMotion.current = false
      return
    }
    if (reduceMotion()) return
    const { current, previousVisuals } = getMotionLayers()
    if (!current || typeof current.animate !== 'function') return
    const animations: Animation[] = []
    if (motion === 'tab') {
      animations.push(
        current.animate(
          [
            {
              opacity: 0.92,
              transform:
                view === 'map' ? 'translate3d(0, 0, 0)' : 'translate3d(0, 5px, 0) scale(.997)',
            },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          ],
          {
            duration: 180,
            easing: 'cubic-bezier(.22, .82, .2, 1)',
            fill: 'both',
          },
        ),
      )
      if (
        view === 'map' &&
        mapHostRef.current &&
        typeof mapHostRef.current.animate === 'function'
      ) {
        animations.push(
          mapHostRef.current.animate([{ opacity: 0.9 }, { opacity: 1 }], {
            duration: 180,
            easing: 'cubic-bezier(.22, .82, .2, 1)',
            fill: 'both',
          }),
        )
      }
    } else if (motion === 'push') {
      animations.push(
        current.animate(
          [
            {
              opacity: 0.98,
              transform: 'translate3d(100%, 0, 0)',
              boxShadow: '-12px 0 30px rgb(0 0 0 / 0.14)',
            },
            {
              opacity: 1,
              transform: 'translate3d(0, 0, 0)',
              boxShadow: '-12px 0 30px rgb(0 0 0 / 0)',
            },
          ],
          {
            duration: 280,
            easing: 'cubic-bezier(.2, .84, .2, 1)',
            fill: 'both',
          },
        ),
      )
      previousVisuals.forEach((element) => {
        if (typeof element.animate !== 'function') return
        animations.push(
          element.animate(
            [
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
              {
                opacity: 0.9,
                transform: `translate3d(-${BACK_PARALLAX * 100}%, 0, 0)`,
              },
            ],
            {
              duration: 280,
              easing: 'cubic-bezier(.2, .84, .2, 1)',
              fill: 'both',
            },
          ),
        )
      })
    } else {
      animations.push(
        current.animate(
          [
            { opacity: 0.96, transform: 'translate3d(-6%, 0, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          ],
          {
            duration: 220,
            easing: 'cubic-bezier(.22, .82, .2, 1)',
            fill: 'both',
          },
        ),
      )
    }
    routeAnimations.current = animations
    return () => {
      animations.forEach((animation) => {
        try {
          animation.cancel()
        } catch { }
      })
      if (routeAnimations.current === animations) routeAnimations.current = []
    }
  }, [view, id, motion, cancelRouteAnimations, getMotionLayers])
}
