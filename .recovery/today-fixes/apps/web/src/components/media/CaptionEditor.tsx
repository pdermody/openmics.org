import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { MediaItem } from '../../features/media'
import { availableCaptionTokens, defaultCaption, substituteCaption, type CaptionTokenName } from '../../features/media-captions'
import { captionValuesOf } from './MediaGallery'

export const CAPTION_LIMIT = 500
export const CAPTION_WARNING_AT = 450

const TOKEN_LABEL_KEYS: Record<CaptionTokenName, string> = {
  performer_name: 'mediaTokenPerformerName',
  performer_city: 'mediaTokenPerformerCity',
  event_name: 'mediaTokenEventName',
  event_date: 'mediaTokenEventDate',
}

// Shared by the inline tile quick-edit and the full lightbox editor (design §7.4): token
// helper listing only the tokens that resolve for this media, and a live preview computed
// with this media's actual attribution values.
export function CaptionEditor({ item, value, onChange, form = 'long' }: {
  item: MediaItem
  value: string
  onChange: (value: string) => void
  form?: 'short' | 'long'
}) {
  const { t } = useTranslation()
  const tokens = useMemo(
    () => availableCaptionTokens({ attributed: Boolean(item.attribution), eventScoped: Boolean(item.event_id) }),
    [item.attribution, item.event_id],
  )
  const values = captionValuesOf(item)
  const preview = value.trim() ? substituteCaption(value, values) : defaultCaption(values, form)
  const remaining = CAPTION_LIMIT - value.length

  return (
    <div className="caption-editor">
      <label className="caption-editor-field">
        <span>{t('mediaCaptionLabel')}</span>
        <textarea
          value={value}
          maxLength={CAPTION_LIMIT}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          placeholder={defaultCaption(values, form) || t('mediaCaptionPlaceholder')}
        />
      </label>
      <p className={`field-hint caption-editor-count${remaining <= CAPTION_LIMIT - CAPTION_WARNING_AT ? ' caption-editor-count-warning' : ''}`} role={remaining < 0 ? 'alert' : undefined}>
        {t('mediaCaptionCount', { count: Math.max(0, remaining) })}
      </p>
      {tokens.length > 0 && (
        <p className="field-hint caption-editor-tokens">
          {t('mediaCaptionTokensAvailable')}: {tokens.map((token) => <code key={token} title={t(TOKEN_LABEL_KEYS[token])}>{`{${token}}`}</code>)}
        </p>
      )}
      <p className="field-hint caption-editor-preview" aria-live="polite">
        {t('mediaCaptionPreview')}: {preview || t('mediaCaptionEmpty')}
      </p>
    </div>
  )
}
