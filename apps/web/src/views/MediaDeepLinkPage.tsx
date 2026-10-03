import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { ApiError } from '../api/client'
import { useMediaItem } from '../features/media'
import { ReadState, SiteHeader, type ThemeProps } from './shared'

// Canonical media deep-link (design §12.1): loads the media, then replaces the URL with
// its owning event/series context so the lightbox opens on top of the natural gallery.
// Hidden media (consent-revoked, soft-deleted) redirects to the surrounding page with a
// "not available anymore" toast; truly unknown media falls back to a bare notice page.
export function MediaDeepLinkPage({ mediaId, theme, mode }: { mediaId: string } & ThemeProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const item = useMediaItem(mediaId)
  const [hiddenRedirect, setHiddenRedirect] = useState(false)

  useEffect(() => {
    const media = item.data
    if (!media) return
    if (media.event_id) {
      void navigate({ to: '/events/$eventId', params: { eventId: media.event_id }, search: { media: media.id }, replace: true })
    } else if (media.open_mic_id) {
      void navigate({ to: '/open-mics/$openMicId', params: { openMicId: media.open_mic_id }, search: { media: media.id }, replace: true })
    }
  }, [item.data, navigate])

  useEffect(() => {
    const error = item.error
    if (!(error instanceof ApiError) || error.code !== 'MEDIA_HIDDEN') return
    const details = error.details as { event_id?: string | null; open_mic_id?: string | null } | undefined
    if (details?.event_id) {
      void navigate({ to: '/events/$eventId', params: { eventId: details.event_id }, search: { mediaUnavailable: mediaId }, replace: true })
    } else if (details?.open_mic_id) {
      void navigate({ to: '/open-mics/$openMicId', params: { openMicId: details.open_mic_id }, search: { mediaUnavailable: mediaId }, replace: true })
    } else {
      setHiddenRedirect(true)
    }
  }, [item.error, navigate, mediaId])

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      {hiddenRedirect || (item.isError && !hiddenRedirect) ? (
        <ReadState message={t('mediaUnavailableNotice')} />
      ) : (
        <ReadState message={t('loading')} />
      )}
    </main>
  )
}
