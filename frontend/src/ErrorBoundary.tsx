import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Кутёж frontend error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <button type="button" onClick={() => window.location.reload()}>
        Перезагрузить приложение
      </button>
    )
  }
}
