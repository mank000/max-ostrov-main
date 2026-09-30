import { levels, type Level } from './game'
import { Back, Button, Icon } from './ui'

export function MemoryHome({ level, onLevel, onPlay }: { level: Level; onLevel: (value: Level) => void; onPlay: () => void }) {
  return <main className="scroll home">
    <p className="intro">Небольшая пауза. Новая победа.</p>
    <div className="game-art" aria-hidden="true">
      <span className="art-card art-card--open"><Icon name="heart" size={36} /></span>
      <span className="art-card"><Back /></span>
      <span className="art-card art-card--open"><Icon name="star" size={36} /></span>
      <span className="art-card"><Back /></span>
    </div>
    <h2>Найди пару</h2>
    <p className="meta">Память · 1–3 минуты</p>
    <p className="description">Открывай карточки и находи одинаковые.<br />Меньше ходов — лучше результат.</p>
    <div className="levels" role="group" aria-label="Сложность">
      {levels.map(item => <button key={item.id} aria-pressed={item.id === level} onClick={() => onLevel(item.id)}>{item.name}<small>{item.pairs} пар</small></button>)}
    </div>
    <Button onClick={onPlay}>Начать игру</Button>
    <section className="rules" aria-labelledby="rules-title">
      <h3 id="rules-title">Как играть</h3>
      <ol><li>Открой две карточки</li><li>Запомни, если они разные</li><li>Собери все пары</li></ol>
    </section>
  </main>
}
