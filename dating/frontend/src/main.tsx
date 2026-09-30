import '../../../frontend/src/ui/tokens.css'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MaxUI } from '@maxhub/max-ui'
import '@maxhub/max-ui/dist/styles.css'
import { readStorage } from './api'
import { App } from './App'
import './style.css'
import './standalone.css'

function currentTheme(): 'light' | 'dark' {
  const saved = readStorage('dating-theme') || 'auto'
  if (saved === 'dark') return 'dark'
  if (saved === 'light') return 'light'
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function Root() {
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>(currentTheme)

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setColorScheme(currentTheme())
    window.addEventListener('dating-theme-change', update)
    media.addEventListener('change', update)
    return () => {
      window.removeEventListener('dating-theme-change', update)
      media.removeEventListener('change', update)
    }
  }, [])

  return (
    <MaxUI colorScheme={colorScheme} className="dating-root">
      <App />
    </MaxUI>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
