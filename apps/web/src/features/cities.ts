import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export type City = {
  id: string
  city: string
  city_ascii: string
  country: string
  country_ascii: string
  iso2: string
  iso3: string | null
  admin_name: string | null
  lat: number
  lng: number
  population: number | null
  retired: boolean
}

export type CityAutocompleteValue = { text: string; city: City | null }
export const cityKeys = {
  detail: (id: string | null | undefined) => ['cities', id] as const,
  search: (q: string) => ['cities', 'search', q] as const,
}

export function useCity(id: string | null | undefined) {
  return useQuery({
    queryKey: cityKeys.detail(id),
    queryFn: ({ signal }) => api<City>(`/cities/${encodeURIComponent(id!)}`, { signal }),
    enabled: Boolean(id),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  })
}

export function useCitySearch(q: string, enabled = true) {
  const text = q.trim()
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 300)
    return () => clearTimeout(timer)
  }, [text])
  return useQuery({
    queryKey: cityKeys.search(text),
    queryFn: ({ signal }) => api<{ items: City[] }>(`/cities/search?q=${encodeURIComponent(text)}`, { signal }),
    enabled: enabled && text.length >= 2 && debounced === text,
    staleTime: 60_000,
    retry: false,
  })
}
