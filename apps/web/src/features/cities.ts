import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
    staleTime: Infinity,
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

export function useExternalCitySearch() {
  return useMutation({
    mutationFn: ({ q }: { q: string }) => api<{ items: City[] }>('/cities/search-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
    }),
  })
}

/** Selecting caches the complete place, so loading a saved reference never reseeds a venue pin. */
export function useRememberCity() {
  const client = useQueryClient()
  return (city: City) => client.setQueryData(cityKeys.detail(city.id), city)
}
