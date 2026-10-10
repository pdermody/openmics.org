import { Link, useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'

declare module '@tanstack/history' {
  interface HistoryState {
    publicDetailsReturn?: {
      resource: string
      search: string
      scrollY: number
      focusId: string
      gallerySeed?: number
    }
    restorePublicLanding?: HistoryState['publicDetailsReturn']
  }
}

export function PublicDetailsLink({ kind, id, handle, section, ariaLabel, children }: {
  kind: 'event' | 'open-mic'; id: string; handle?: string | null; section?: string; ariaLabel?: string; children: ReactNode
}) {
  const location = useLocation()
  const focusId = `details-${section ?? 'all'}`
  const common = {
    id: focusId,
    className: section ? 'detail-location-link' : 'quiet-button',
    hash: section,
    'aria-label': ariaLabel,
    state: () => ({ publicDetailsReturn: {
      resource: `${kind}:${id}`, search: window.location.search,
      scrollY: window.scrollY, focusId, gallerySeed: location.state.detailGallerySeed,
    } }),
  }
  if (kind === 'event') return handle
    ? <Link {...common} to="/@{$handle}/events/$eventId/details" params={{ handle, eventId: id }}>{children}</Link>
    : <Link {...common} to="/events/$eventId/details" params={{ eventId: id }}>{children}</Link>
  return handle
    ? <Link {...common} to="/@{$handle}/details" params={{ handle }}>{children}</Link>
    : <Link {...common} to="/open-mics/$openMicId/details" params={{ openMicId: id }}>{children}</Link>
}
