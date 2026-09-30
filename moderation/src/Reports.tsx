import { useState } from 'react'
import {
  moderationApi,
  type Decision,
  type Report,
  type ReportStatus,
  type Session,
  type TargetType,
} from './api'
import { Icon, dateTime } from './ui'

export const labels: Record<TargetType, string> = {
  user: 'Пользователь',
  post: 'Публикация',
  event: 'Мероприятие',
  comment: 'Комментарий',
}

export const statusLabels: Record<ReportStatus, string> = {
  open: 'Новые',
  reviewed: 'Рассмотренные',
  dismissed: 'Отклонённые',
}

function snapshotValue(snapshot: Report['target_snapshot'], ...keys: string[]): string {
  if (!snapshot) return ''
  for (const key of keys) {
    const value = snapshot[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function reportSubject(report: Report) {
  return (
    snapshotValue(report.target_snapshot, 'title', 'caption', 'body', 'display_name', 'name') ||
    `${labels[report.target_type]} #${report.target_id}`
  )
}

function reportAuthor(report: Report) {
  const name = snapshotValue(report.target_snapshot, 'author_display_name', 'author_name')
  const username = snapshotValue(report.target_snapshot, 'author_username').replace(/^@+/, '')
  if (name && username) return `${name} (@${username})`
  return name || (username ? `@${username}` : '')
}

function mediaIds(snapshot: Report['target_snapshot']): number[] {
  const items = snapshot?.media_ids
  return Array.isArray(items)
    ? items.filter(
      (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    )
    : []
}

export function ReportRow({
  report,
  selected,
  onSelect,
}: {
  report: Report
  selected: boolean
  onSelect: () => void
}) {
  const author = report.target_type === 'post' ? reportAuthor(report) : ''
  return (
    <button
      className={`report-row${selected ? ' is-selected' : ''}`}
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      <span className="report-row__type">
        <Icon
          name={
            report.target_type === 'user'
              ? 'person'
              : report.target_type === 'post'
                ? 'post'
                : report.target_type === 'event'
                  ? 'event'
                  : 'comment'
          }
          size={21}
        />
        <small>{labels[report.target_type]}</small>
      </span>
      <span className="report-row__subject">
        <strong>{reportSubject(report)}</strong>
        <small>{author ? `${author} · ${report.reason}` : report.reason}</small>
      </span>
      <span className="report-row__reporter">
        {report.reporter_user_id ? `#${report.reporter_user_id}` : '—'}
      </span>
      <span className="report-row__time">{dateTime(report.created_at)}</span>
      <span className={`status status--${report.status}`}>
        {report.status === 'open'
          ? 'Новая'
          : report.status === 'reviewed'
            ? 'Рассмотрена'
            : 'Отклонена'}
      </span>
      <Icon name="arrow" size={17} />
    </button>
  )
}

export function ReportDetail({
  report,
  role,
  busy,
  onDecision,
  onBack,
}: {
  report: Report
  role: Session['role']
  busy: boolean
  onDecision: (action: Decision, reason: string) => Promise<boolean>
  onBack: () => void
}) {
  const [reason, setReason] = useState('')
  const [action, setAction] = useState<Decision | null>(null)
  const ids = mediaIds(report.target_snapshot)
  const body = snapshotValue(report.target_snapshot, 'body', 'caption', 'description')
  const author = report.target_type === 'post' ? reportAuthor(report) : ''
  const choices: Array<{ action: Decision; label: string; tone?: string }> =
    report.target_type === 'user'
      ? [
        { action: 'dismiss', label: 'Отклонить жалобу' },
        ...(role === 'administrator'
          ? [
            {
              action: 'suspend' as const,
              label: 'Ограничить пользователя',
              tone: 'danger',
            },
            { action: 'unsuspend' as const, label: 'Снять ограничение' },
          ]
          : []),
      ]
      : [
        { action: 'dismiss', label: 'Отклонить жалобу' },
        {
          action: 'hide',
          label: `Скрыть ${report.target_type === 'event' ? 'мероприятие' : report.target_type === 'comment' ? 'комментарий' : 'публикацию'}`,
          tone: 'danger',
        },
        { action: 'restore', label: 'Восстановить' },
      ]

  return (
    <section className="inspector" aria-label={`Жалоба #${report.id}`}>
      <div className="inspector__top">
        <button
          className="inspector__back"
          type="button"
          onClick={onBack}
          aria-label="Назад к очереди"
        >
          <Icon name="arrow" size={20} />
        </button>
        <span>Жалоба #{report.id}</span>
        <span className={`status status--${report.status}`}>
          {report.status === 'open'
            ? 'Новая'
            : report.status === 'reviewed'
              ? 'Рассмотрена'
              : 'Отклонена'}
        </span>
      </div>
      <h2>
        Жалоба на{' '}
        {report.target_type === 'user'
          ? 'пользователя'
          : report.target_type === 'post'
            ? 'публикацию'
            : report.target_type === 'event'
              ? 'мероприятие'
              : 'комментарий'}
      </h2>
      <p className="inspector__meta">
        {labels[report.target_type]} #{report.target_id} · {dateTime(report.created_at)}
      </p>
      <div className="inspector__scroll">
        <section className="inspector-section">
          <h3>Объект жалобы</h3>
          <div className="evidence-card">
            <strong>{reportSubject(report)}</strong>
            {author && <span>Автор: {author}</span>}
            {body && <p>{body}</p>}
            {ids.length > 0 && (
              <div className="evidence-media">
                {ids.map((id) =>
                  report.media?.find((item) => item.id === id)?.mime_type.startsWith('video/') ? (
                    <video
                      key={id}
                      controls
                      playsInline
                      preload="metadata"
                      src={moderationApi.reportMediaURL(report.id, id)}
                      aria-label={`Видео ${id}`}
                    />
                  ) : (
                    <a
                      key={id}
                      href={moderationApi.reportMediaURL(report.id, id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={moderationApi.reportMediaURL(report.id, id)}
                        alt={`Медиафайл ${id}`}
                        loading="lazy"
                      />
                    </a>
                  ),
                )}
              </div>
            )}
          </div>
        </section>
        <section className="inspector-section">
          <h3>Причина жалобы</h3>
          <p className="report-reason">{report.reason}</p>
          <span className="inspector__meta">
            {report.reporter_user_id
              ? `От пользователя #${report.reporter_user_id}`
              : 'Системная жалоба'}
          </span>
        </section>
        {report.reviewed_by_user_id && (
          <section className="inspector-section">
            <h3>Последнее решение</h3>
            <p>
              Рассмотрено пользователем #{report.reviewed_by_user_id} ·{' '}
              {dateTime(report.reviewed_at)}
            </p>
          </section>
        )}
        <section className="inspector-section inspector-section--decision">
          <h3>Принять решение</h3>
          {report.target_type === 'user' && role !== 'administrator' && (
            <p className="inspector__hint">
              Ограничить или восстановить пользователя может администратор.
            </p>
          )}
          <div className="decision-choices">
            {choices.map((choice) => (
              <button
                key={choice.action}
                type="button"
                className={`decision-choice${action === choice.action ? ' is-selected' : ''}${choice.tone ? ` decision-choice--${choice.tone}` : ''}`}
                aria-pressed={action === choice.action}
                onClick={() => setAction(choice.action)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <label className="field-label" htmlFor="decision-reason">
            Основание решения
          </label>
          <textarea
            id="decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 500))}
            placeholder="Опишите основание — оно сохранится в журнале"
            rows={4}
          />
          <div className="decision-footer">
            <span>{reason.length}/500</span>
            <button
              className="button button--primary"
              type="button"
              disabled={!action || reason.trim().length < 3 || busy}
              onClick={() => {
                if (action)
                  void onDecision(action, reason).then((saved) => {
                    if (saved) {
                      setReason('')
                      setAction(null)
                    }
                  })
              }}
            >
              {busy ? 'Сохраняем…' : 'Сохранить решение'}
            </button>
          </div>
        </section>
      </div>
    </section>
  )
}
