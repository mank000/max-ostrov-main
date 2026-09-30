import { App } from '../../../games/src/App'
import '../../../games/src/embedded.css'
import { request } from '../api/http'
import type { GameRequest } from '../../../games/src/Arcade'
const gameRequest: GameRequest = (path, body) =>
  request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
export default function GamesScreen({
  theme,
  userId,
  onBack,
}: {
  theme: 'light' | 'dark'
  userId: number
  onBack: () => void
}) {
  return (
    <div className="games-root">
      <App
        theme={theme}
        account={String(userId)}
        request={gameRequest}
        onBack={onBack}
      />
    </div>
  )
}
