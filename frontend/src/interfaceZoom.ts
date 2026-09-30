// The viewport meta tag and root touch-action keep the page at app scale.
// Avoid document-level touch listeners: they put every native scroll on the main thread.
export function lockInterfaceZoom() {
  const prevent = (event: Event) => { if (event.cancelable) event.preventDefault() }
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) prevent(event)
  }
  const key = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) prevent(event)
  }
  const options = { passive: false, capture: true }
  document.addEventListener('wheel', wheel, options)
  document.addEventListener('keydown', key, true)
  for (const name of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(name, prevent, options)
  return () => {
    document.removeEventListener('wheel', wheel, true)
    document.removeEventListener('keydown', key, true)
    for (const name of ['gesturestart', 'gesturechange', 'gestureend'])
      document.removeEventListener(name, prevent, true)
  }
}
