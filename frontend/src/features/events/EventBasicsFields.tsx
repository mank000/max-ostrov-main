import { mediaURL } from '../../api/credentials'
import { PHOTO_INPUT_ACCEPT } from '../../api/media'
import { Field, Icon } from '../../ui/components/BasicUI'
import { EventCategoryArtwork } from '../../ui/components/ContentCards'
import type { useEventArtwork } from './useEventArtwork'
import type { EventDraft, SetEventField } from './useEventDraft'

export function EventBasicsFields({ draft, setField, setStep, artwork, busy }: {
  draft: EventDraft
  setField: SetEventField
  setStep: (value: number) => void
  artwork: ReturnType<typeof useEventArtwork>
  busy: boolean
}) {
  const { title, description, category } = draft
  const {
    headerArtwork,
    iconArtwork,
    headerPreview,
    iconPreview,
    preparingArtwork,
    chooseArtwork,
    removeArtwork,
  } = artwork
  return (
    <div className="event-form__fields">
      <Field label="Название мероприятия" value={title} maxLength={120} onChange={(value) => setField('title', value)} />
      <button className="event-category-cell" type="button" onClick={() => setStep(-1)}>
        <Icon name="calendar" size={22} />
        <span>
          <strong>Категория</strong>
          <small>{category || 'Выберите категорию'}</small>
        </span>
        <Icon name="chevron" size={18} />
      </button>
      <Field label="Описание" value={description} maxLength={4000} onChange={(value) => setField('description', value)} multiline />
      <p className="event-form__hint">
        Коротко расскажи, что будет происходить и кому стоит прийти.
      </p>
      <section className="event-artwork-editor" aria-label="Оформление мероприятия">
        <div className="event-artwork-editor__head">
          <strong>Оформление</strong>
          <span>Можно пропустить. Шапку и иконку можно выбрать отдельно.</span>
        </div>
        <div className="event-artwork-editor__grid">
          <div className="event-artwork-slot-wrap event-artwork-slot-wrap--header">
            <label
              className={`event-artwork-slot event-artwork-slot--header ${headerPreview ? 'has-image' : ''}`}
            >
              {headerPreview ? (
                <img src={mediaURL(headerPreview)} alt="Шапка мероприятия" />
              ) : (
                <span>
                  <Icon name="photo" size={25} />
                  <strong>Шапка</strong>
                  <small>16:9</small>
                </span>
              )}
              <input
                type="file"
                accept={PHOTO_INPUT_ACCEPT}
                disabled={busy || preparingArtwork}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void chooseArtwork('header', file)
                }}
              />
            </label>
            {headerArtwork && (
              <button
                className="event-artwork-slot__remove"
                type="button"
                aria-label="Убрать шапку"
                onClick={() => removeArtwork('header')}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
          <div className="event-artwork-slot-wrap event-artwork-slot-wrap--icon">
            <label
              className={`event-artwork-slot event-artwork-slot--icon ${iconPreview ? 'has-image' : ''}`}
            >
              {iconPreview ? (
                <img src={mediaURL(iconPreview)} alt="Иконка мероприятия" />
              ) : (
                <>
                  <EventCategoryArtwork
                    event={{
                      category: category || 'Встреча',
                      title: title || 'Мероприятие',
                    }}
                    className="event-artwork-slot__category"
                    size={26}
                  />
                  <small>Иконка · 1:1</small>
                </>
              )}
              <input
                type="file"
                accept={PHOTO_INPUT_ACCEPT}
                disabled={busy || preparingArtwork}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void chooseArtwork('icon', file)
                }}
              />
            </label>
            {iconArtwork && (
              <button
                className="event-artwork-slot__remove"
                type="button"
                aria-label="Убрать иконку"
                onClick={() => removeArtwork('icon')}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        </div>
        <p className="event-artwork-editor__hint">
          Без шапки страница останется обычной, а вместо своей иконки покажем значок
          категории.
        </p>
      </section>
    </div>
  )
}
