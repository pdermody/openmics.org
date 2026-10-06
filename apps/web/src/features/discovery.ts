import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { api } from '../api/client'
import { useAccountContext } from './account'
import type { City } from './cities'
import { getCityCoordinates, type DiscoveryNear } from './publicReads'
import { useBrowserLocation } from '../hooks/geolocation'

export type DiscoverySelection = { lat: number; lng: number; label: string; cityId?: string; radiusKm: number; approximate?: boolean }

type DiscoveryState = {
  latest: DiscoverySelection | null
  entries: Record<string, DiscoverySelection | null>
  remember: (key: string, selection: DiscoverySelection | null) => void
  choose: (key: string, selection: DiscoverySelection | null) => void
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  latest: null,
  entries: {},
  remember: (key, selection) => set((state) => key in state.entries && state.latest === selection ? state : {
    latest: selection,
    entries: key in state.entries ? state.entries : { ...state.entries, [key]: selection },
  }),
  choose: (key, selection) => set((state) => ({ latest: selection, entries: { ...state.entries, [key]: selection } })),
}))

export type SuggestedCity = City & { open_mic_count: number; distance_km: number; approximate?: boolean }
export type DiscoverySuggestions = {
  expansion: { radius_km: number; additional_count: number } | null
  cities: SuggestedCity[]
}

export function useDiscovery() {
  const key = useRouterState({ select: (state) => state.location.state.__TSR_key ?? state.location.href })
  const entries = useDiscoveryStore((state) => state.entries)
  const latest = useDiscoveryStore((state) => state.latest)
  const remember = useDiscoveryStore((state) => state.remember)
  const choose = useDiscoveryStore((state) => state.choose)
  const selection = key in entries ? entries[key] : latest
  const account = useAccountContext()
  const browser = useBrowserLocation()
  const savedCity = account.account.data?.city_location
  const savedCoords = getCityCoordinates(savedCity)
  const local = browser.coords ?? savedCoords
  const locationReady = browser.permissionState !== 'unknown'
    && (browser.permissionState !== 'granted' || Boolean(browser.coords))
  const ready = Boolean(selection) || (!account.account.isPending && locationReady)
  const origin = selection ?? (local ? {
    ...local, radiusKm: 50, label: browser.coords ? undefined : savedCity?.city,
  } : undefined)
  const near: DiscoveryNear | undefined = origin && { lat: origin.lat, lng: origin.lng, radiusKm: origin.radiusKm }
  const cityId = selection?.cityId ?? (!browser.coords ? savedCity?.id : undefined)

  useEffect(() => { remember(key, selection) }, [key, selection, remember])

  function chooseCity(city: City, approximate = false) {
    choose(key, {
      lat: city.lat, lng: city.lng, cityId: approximate ? undefined : city.id,
      label: [city.city, city.admin_name, city.country].filter(Boolean).join(', '),
      radiusKm: 50, approximate,
    })
  }

  function expand(radiusKm: number) {
    if (!near) return
    choose(key, { ...near, radiusKm, cityId, label: selection?.label ?? (browser.coords ? '' : savedCity?.city ?? ''), approximate: selection?.approximate })
  }

  const suggestions = useQuery({
    queryKey: ['discovery', 'suggestions', near, cityId],
    enabled: ready && Boolean(near),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ near: `${near!.lat},${near!.lng}`, radius_km: String(near!.radiusKm) })
      if (cityId) params.set('city_id', cityId)
      return api<DiscoverySuggestions>(`/discovery/suggestions?${params}`, { signal })
    },
  })

  return {
    near, ready, label: origin?.label, approximate: selection?.approximate,
    manual: Boolean(selection), browser, suggestions, chooseCity, expand,
    nearMe: () => choose(key, null),
  }
}
