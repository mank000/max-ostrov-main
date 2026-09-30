import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="shell"><div className="scroll empty"><h1>Не удалось открыть игру</h1><p>Попробуй открыть её ещё раз. Сохранённые рекорды останутся.</p><button className="button" onClick={() => window.location.reload()}>Открыть снова</button></div></main>
  }
}
