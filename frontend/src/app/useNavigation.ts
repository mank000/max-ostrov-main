import { dismissTopDialog } from '../ui/dialogs'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Event } from '../api/events'
import type { HostAdapter } from '../host'
import { mainViews, ROOT_FEED_ROUTE, startRoute, type Route } from '../routes'
import type { MapFocusTarget } from '../screens/MapScreen'
import type { MenuAnchor } from '../ui/components/ContextMenu'
import { BACK_PARALLAX, useBackGesture } from '../useBackGesture'
import { reduceMotion, useRouteMotion, type RouteMotion } from '../useRouteMotion'
import { useViewport } from '../useViewport'

const SERVICE_HUB_ROUTE: Route = { view: 'services', key: 'root:services' }

export type ActionMenu = { view: 'postactions' | 'usermenu'; id: number; anchor?: MenuAnchor } | null

export function useNavigation(host: HostAdapter, userId: number | undefined,
  onMenu: (menu: ActionMenu) => void, blocked: boolean, closeOverlay: () => void, enabled = true, onExit?: () => void) {
  const [route, setRoute] = useState<Route>(startRoute)
  const routeRef = useRef(route)
  useLayoutEffect(() => {
    routeRef.current = route
  }, [route])
  const [mapVisited, setMapVisited] = useState(false)
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null)
  const [routeMotion, setRouteMotion] = useState<RouteMotion>('tab')
  const [stack, setStack] = useState<Route[]>([])
  const [fromServices, setFromServices] = useState(false)
  const savedSocialNavigation = useRef<{ route: Route; stack: Route[] } | null>(null)
  const routeSequence = useRef(0)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLElement | null>(null)
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const routeAnimations = useRef<Animation[]>([])
  const skipNextRouteMotion = useRef(false)
  const navigationLocked = useRef(false)
  const canGoBack = fromServices || stack.length > 0 || !mainViews.has(route.view)
  useEffect(() => {
    if (route.view === 'map') setMapVisited(true)
  }, [route.view])
  const createRoute = useCallback(
    (view: string, id?: number): Route => ({
      view,
      id,
      key: 'route:' + ++routeSequence.current,
    }),
    [],
  )

  const exitToServices = useCallback(() => {
    const saved = savedSocialNavigation.current
    if (saved) {
      routeRef.current = saved.route
      setRoute(saved.route)
      setStack(saved.stack)
      setRouteMotion('tab')
      savedSocialNavigation.current = null
    }
    setFromServices(false)
    onExit?.()
  }, [onExit])

  const openFromServices = useCallback((view: string) => {
    if (navigationLocked.current) return
    savedSocialNavigation.current ??= { route: routeRef.current, stack }
    const next = createRoute(view)
    routeRef.current = next
    setFromServices(true)
    setStack([])
    setRoute(next)
    setRouteMotion('tab')
    host.hapticSelection()
  }, [createRoute, host, stack])

  useEffect(() => {
    if (!enabled && savedSocialNavigation.current) exitToServices()
  }, [enabled, exitToServices])

  const navigate = useCallback(
    (view: string, id?: number, anchor?: MenuAnchor) => {
      if (navigationLocked.current) return
      host.hapticSelection()
      if ((view === 'postactions' || view === 'usermenu') && id) {
        onMenu({ view, id, anchor })
        return
      }
      onMenu(null)
      const targetView = view === 'userprofile' && id && id === userId ? 'profile' : view
      const targetIsMain = mainViews.has(targetView) && !fromServices
      if (targetView === 'map') setMapFocusTarget(null)
      setRouteMotion(targetIsMain ? 'tab' : 'push')

      const previousRoute = routeRef.current
      const nextRoute = createRoute(targetView, targetIsMain ? undefined : id)
      routeRef.current = nextRoute
      setRoute(nextRoute)
      if (targetIsMain) {
        setStack([])
        return
      }
      setStack((current) => [...current, previousRoute])
    },
    [host, userId, createRoute, onMenu, fromServices],
  )

  useEffect(() => {
    const handleExternalNavigate = (event: CustomEvent<{ view?: string; id?: number }>) => {
      const detail = event.detail
      if (!detail || typeof detail.view !== 'string') return
      const id = typeof detail.id === 'number' && Number.isFinite(detail.id) ? detail.id : undefined
      navigate(detail.view, id)
    }
    window.addEventListener('kutezh:navigate', handleExternalNavigate as EventListener)
    return () => window.removeEventListener('kutezh:navigate', handleExternalNavigate as EventListener)
  }, [navigate])

  const openEventOnMap = useCallback(
    (event: Event) => {
      const { latitude, longitude } = event.location
      navigate('map')
      if (
        typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude)
      )
        return
      setMapFocusTarget({
        eventId: event.id,
        latitude,
        longitude,
        title: event.title,
        startsAt: event.starts_at,
        category: event.category,
      })
    },
    [navigate],
  )
  const cancelRouteAnimations = useCallback(() => {
    routeAnimations.current.forEach((animation) => {
      try {
        animation.cancel()
      } catch { }
    })
    routeAnimations.current = []
  }, [])

  const getMotionLayers = useCallback(() => {
    const content = contentRef.current
    const current =
      content?.querySelector<HTMLElement>('.route-layer[data-layer-role="current"]') || null
    const previous =
      content?.querySelector<HTMLElement>('.route-layer[data-layer-role="previous"]') || null
    const currentVisuals = current ? [current] : []
    const previousVisuals = previous ? [previous] : []
    if (current?.dataset.view === 'map' && mapHostRef.current)
      currentVisuals.unshift(mapHostRef.current)
    if (previous?.dataset.view === 'map' && mapHostRef.current)
      previousVisuals.unshift(mapHostRef.current)
    return { current, previous, currentVisuals, previousVisuals }
  }, [])

  const commitBack = useCallback(
    (skipMotion = false) => {
      if (!canGoBack) return
      if (fromServices && stack.length === 0) { exitToServices(); return }
      if (skipMotion) skipNextRouteMotion.current = true
      setRouteMotion('pop')
      setRoute(stack[stack.length - 1] || ROOT_FEED_ROUTE)
      setStack(stack.length ? stack.slice(0, -1) : [])
    },
    [stack, canGoBack, fromServices, exitToServices],
  )

  const back = useCallback(() => {
    if (!canGoBack || navigationLocked.current) return
    host.hapticSelection()
    if (reduceMotion()) {
      commitBack(true)
      return
    }
    const { current, previousVisuals } = getMotionLayers()
    if (!current || !previousVisuals.length || typeof current.animate !== 'function') {
      commitBack(false)
      return
    }
    navigationLocked.current = true
    previousVisuals.forEach((element) => {
      element.style.transform = `translate3d(-${BACK_PARALLAX * 100}%, 0, 0)`
    })
    cancelRouteAnimations()
    const duration = 240
    const animations = [
      current.animate(
        [
          {
            transform: 'translate3d(0, 0, 0)',
            boxShadow: '-10px 0 26px rgb(0 0 0 / 0.12)',
          },
          {
            transform: 'translate3d(100%, 0, 0)',
            boxShadow: '-10px 0 26px rgb(0 0 0 / 0)',
          },
        ],
        { duration, easing: 'cubic-bezier(.22, .82, .2, 1)', fill: 'both' },
      ),
      ...previousVisuals
        .filter((element) => typeof element.animate === 'function')
        .map((element) =>
          element.animate(
            [
              {
                transform: `translate3d(-${BACK_PARALLAX * 100}%, 0, 0)`,
                opacity: 0.9,
              },
              { transform: 'translate3d(0, 0, 0)', opacity: 1 },
            ],
            { duration, easing: 'cubic-bezier(.22,.82,.2,1)', fill: 'both' },
          ),
        ),
    ]
    routeAnimations.current = animations
    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(
      () => {
        animations.forEach((animation) => {
          try {
            animation.cancel()
          } catch { }
        })
        routeAnimations.current = []
        current.style.transform = 'translate3d(100%, 0, 0)'
        current.style.boxShadow = 'none'
        previousVisuals.forEach((element) => {
          element.style.transform = 'translate3d(0, 0, 0)'
          element.style.opacity = '1'
        })
        flushSync(() => commitBack(true))
        current.style.removeProperty('transform')
        current.style.removeProperty('box-shadow')
        previousVisuals.forEach((element) => {
          element.style.removeProperty('transform')
          element.style.removeProperty('opacity')
        })
        navigationLocked.current = false
      },
    )
  }, [canGoBack, host, commitBack, getMotionLayers, cancelRouteAnimations])
  useEffect(() => {
    if (!enabled) return
    const button = host.backButton
    if (!button) return
    const closeOrBack = () => { if (dismissTopDialog()) return; if (blocked) closeOverlay(); else if (canGoBack) back(); else onExit?.() }
    if (canGoBack || blocked || onExit) button.show()
    else button.hide()
    button.onClick(closeOrBack)
    return () => button.offClick(closeOrBack)
  }, [host, canGoBack, back, blocked, closeOverlay, enabled, onExit])

  useBackGesture({
    shellRef,
    canGoBack: canGoBack && enabled,
    blocked,
    host,
    commitBack,
    getMotionLayers,
    cancelRouteAnimations,
    routeAnimations,
    navigationLocked,
  })

  useRouteMotion({
    view: route.view,
    id: route.id,
    motion: routeMotion,
    mapHostRef,
    routeAnimations,
    skipNextRouteMotion,
    cancelRouteAnimations,
    getMotionLayers,
  })

  const currentMain = mainViews.has(route.view)
    ? route.view
    : [...stack].reverse().find((item) => mainViews.has(item.view))?.view || 'feed'
  const routeTrail: Route[] = stack.length
    ? [...stack, route]
    : fromServices
      ? [SERVICE_HUB_ROUTE, route]
      : mainViews.has(route.view)
        ? [route]
        : [ROOT_FEED_ROUTE, route]
  const mapInTrail = routeTrail.some((item) => item.view === 'map')
  useViewport()
  function replaceRoute(view: string, id?: number, clearStack = false) {
    const next = createRoute(view, id)
    routeRef.current = next
    setRouteMotion('tab')
    setRoute(next)
    if (clearStack) setStack([])
  }
  return {
    route, routeRef, stack, mapVisited, mapFocusTarget, setMapFocusTarget,
    shellRef, contentRef, mapHostRef, navigate, back, openEventOnMap, currentMain,
    routeTrail, mapInTrail, replaceRoute, fromServices, openFromServices, exitToServices
  }
}
