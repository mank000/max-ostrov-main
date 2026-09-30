import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { lockInterfaceZoom } from './interfaceZoom'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

const unlockInterfaceZoom = lockInterfaceZoom()
import.meta.hot?.dispose(unlockInterfaceZoom)

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
