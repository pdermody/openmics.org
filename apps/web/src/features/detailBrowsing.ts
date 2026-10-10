import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import type { PublicEventsFilters } from './publicReads'

export type DetailTab = 'events' | 'photos' | 'videos'
export type DetailBrowseState = PublicEventsFilters & { tab: DetailTab; sort: 'newest' | 'shuffle'; media?: string }

declare module '@tanstack/history' {
  interface HistoryState {
    detailGallerySeed?: number
  }
}

export function parseDetailBrowse(search: string, series: boolean): DetailBrowseState {
  const params = new URLSearchParams(search)
  const integer = (key: string, max: number) => {
    const value = Number(params.get(key))
    return Number.isInteger(value) && value > 0 && value <= max ? value : undefined
  }
  const tab = params.get('tab')
  const legacy = params.get('type')
  const year = integer('year', 9999)
  return {
    tab: tab === 'photos' || tab === 'videos' || (series && tab === 'events') ? tab
      : legacy === 'photo' ? 'photos' : legacy === 'video' ? 'videos' : series ? 'events' : 'photos',
    period: params.get('period') === 'past' ? 'past' : 'upcoming',
    page: integer('page', 100000) ?? 1,
    year,
    month: year ? integer('month', 12) : undefined,
    sort: params.get('sort') === 'shuffle' ? 'shuffle' : 'newest',
    media: params.get('media') ?? undefined,
  }
}

export function useDetailBrowsing(series: boolean) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [landingPath] = useState(pathname)
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const historyState = useRouterState({ select: (state) => state.location.state })
  const navigate = useNavigate()
  const [defaultSort] = useState<'newest' | 'shuffle'>(() => localStorage.getItem('openmic-media-sort') === 'shuffle' ? 'shuffle' : 'newest')
  const [initialSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const shuffleSeed = historyState.detailGallerySeed ?? initialSeed
  const state = parseDetailBrowse(search, series)
  if (!new URLSearchParams(search).has('sort')) state.sort = defaultSort
  const update = useCallback((changes: Partial<DetailBrowseState>, replace = false) => {
    if (pathname !== landingPath) return
    void navigate({
      to: '.', replace, resetScroll: false,
      search: (previous) => ({ ...previous, ...changes, type: undefined }),
      state: (previous) => ({ ...previous, detailGallerySeed: shuffleSeed }),
    })
  }, [navigate, shuffleSeed, pathname, landingPath])
  const updateShuffleSeed = (seed: number) => {
    if (pathname !== landingPath) return
    void navigate({ to: '.', replace: true, resetScroll: false, search: (previous) => previous,
      state: (previous) => ({ ...previous, detailGallerySeed: seed }) })
  }
  useEffect(() => {
    if (pathname !== landingPath) return
    localStorage.setItem('openmic-media-sort', state.sort)
    if (historyState.detailGallerySeed === undefined || !new URLSearchParams(search).has('sort')) update({ sort: state.sort }, true)
  }, [pathname, landingPath, historyState.detailGallerySeed, search, state.sort, update])
  return { state, update, shuffleSeed, updateShuffleSeed }
}
