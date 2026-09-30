/** Host back buttons must dismiss the active picker before leaving its screen. */
export function dismissTopDialog() {
  const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1)
  if (!dialog) return false
  const cancel = new Event('cancel', { cancelable: true })
  if (dialog.dispatchEvent(cancel)) dialog.close()
  return true
}
