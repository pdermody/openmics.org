import { useState } from 'react'
import { http, HttpResponse } from 'msw'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CityAutocomplete } from '../components/location/CityAutocomplete'
import type { CityAutocompleteValue } from '../features/cities'
import { dublinCity as dublin } from './city-fixtures'
import { renderWithProviders } from './render'
import { server } from './server'

function Picker({ initial = { text: '', city: null }, onChange = vi.fn() }: { initial?: CityAutocompleteValue; onChange?: (value: CityAutocompleteValue) => void }) {
  const [value, setValue] = useState<CityAutocompleteValue>(initial)
  return <CityAutocomplete value={value.text} selectedCity={value.city} onChange={(text, city) => { const next = { text, city }; setValue(next); onChange(next) }} />
}

describe('CityAutocomplete', () => {
  it('opens safely with an empty geographic chooser', () => {
    renderWithProviders(<CityAutocomplete value="" selectedCity={null} onChange={vi.fn()} allowFreeText={false} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks unresolved geographic text invalid when free text is disabled', () => {
    const changed = vi.fn()
    const { rerender } = renderWithProviders(<CityAutocomplete value="Dub" selectedCity={null} allowFreeText={false} onChange={changed} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Choose a city from the suggestions to search nearby.')).toBeInTheDocument()
    rerender(<CityAutocomplete value="Dublin" selectedCity={dublin} allowFreeText={false} onChange={changed} />)
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-invalid')
  })

  it('debounces catalogue lookup from two characters and selects with the keyboard', async () => {
    const searches = vi.fn()
    const changed = vi.fn()
    server.use(http.get('/api/cities/search', ({ request }) => {
      searches(new URL(request.url).searchParams.get('q'))
      return HttpResponse.json({ items: [dublin, { ...dublin, id: 'us-dublin', country: 'United States', admin_name: 'California', iso2: 'US' }] })
    }))
    renderWithProviders(<Picker onChange={changed} />)
    const input = screen.getByRole('combobox', { name: 'City' })
    fireEvent.change(input, { target: { value: 'D' } })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
    expect(searches).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Du' } })
    fireEvent.change(input, { target: { value: 'Dub' } })
    expect(searches).not.toHaveBeenCalled()
    const options = await screen.findAllByRole('option')
    expect(searches).toHaveBeenCalledExactlyOnceWith('Dub')
    expect(options[0]).toHaveTextContent('Dublin, Ireland')
    expect(options[1]).toHaveTextContent('California, United States')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('Dublin')
    expect(changed).toHaveBeenLastCalledWith({ text: 'Dublin', city: dublin })
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps unmatched text and only uses the provider after an explicit action', async () => {
    const external = vi.fn()
    const changed = vi.fn()
    server.use(
      http.get('/api/cities/search', () => HttpResponse.json({ items: [] })),
      http.post('/api/cities/search-external', async ({ request }) => {
        external(await request.json())
        return HttpResponse.json({ items: [dublin] })
      }),
    )
    renderWithProviders(<Picker onChange={changed} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'My hometown' } })
    expect(await screen.findByText('No cities found. Keep your text or search more places.')).toBeInTheDocument()
    expect(changed).toHaveBeenLastCalledWith({ text: 'My hometown', city: null })
    expect(external).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search more places' }))
    fireEvent.click(await screen.findByRole('option'))
    expect(external).toHaveBeenCalledExactlyOnceWith({ q: 'My hometown' })
    expect(changed).toHaveBeenLastCalledWith({ text: 'Dublin', city: dublin })
  })

  it.each([
    [400, 'Please enter a valid city search.'],
    [429, 'Place search has reached its limit.'],
    [503, 'City search is unavailable.'],
  ])('shows typed external %s failures without losing free text', async (status, message) => {
    server.use(
      http.get('/api/cities/search', () => HttpResponse.json({ items: [] })),
      http.post('/api/cities/search-external', () => HttpResponse.json({ error: { code: 'CITY_SEARCH_ERROR', message: 'failed' } }, { status })),
    )
    renderWithProviders(<Picker />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Missing city' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search more places' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('combobox')).toHaveValue('Missing city')
  })

  it('clears selected identity on text changes and on Clear', () => {
    const changed = vi.fn()
    server.use(http.get('/api/cities/search', () => HttpResponse.json({ items: [] })))
    renderWithProviders(<Picker initial={{ text: dublin.city, city: dublin }} onChange={changed} />)
    expect(screen.getByText('Dublin, Ireland')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dublin outskirts' } })
    expect(changed).toHaveBeenLastCalledWith({ text: 'Dublin outskirts', city: null })
    fireEvent.click(screen.getByRole('button', { name: 'Clear city' }))
    expect(changed).toHaveBeenLastCalledWith({ text: '', city: null })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not offer stale catalogue or external results after the query changes', async () => {
    let completeExternal: () => void = () => undefined
    server.use(
      http.get('/api/cities/search', () => HttpResponse.json({ items: [] })),
      http.post('/api/cities/search-external', async () => {
        await new Promise<void>((resolve) => { completeExternal = resolve })
        return HttpResponse.json({ items: [dublin] })
      }),
    )
    renderWithProviders(<Picker />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Dub' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search more places' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search more places' })).toBeDisabled())
    fireEvent.change(input, { target: { value: 'Cork' } })
    completeExternal()
    await screen.findByText('No cities found. Keep your text or search more places.')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(input).toHaveValue('Cork')
  })

  it('ignores a late catalogue response from a previous query', async () => {
    let completeOldSearch: () => void = () => undefined
    let oldSearchStarted = false
    server.use(http.get('/api/cities/search', async ({ request }) => {
      if (new URL(request.url).searchParams.get('q') === 'Dub') {
        oldSearchStarted = true
        await new Promise<void>((resolve) => { completeOldSearch = resolve })
        return HttpResponse.json({ items: [dublin] })
      }
      return HttpResponse.json({ items: [{ ...dublin, id: 'city-cork', city: 'Cork', admin_name: 'Cork' }] })
    }))
    renderWithProviders(<Picker />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Dub' } })
    await waitFor(() => expect(oldSearchStarted).toBe(true))
    fireEvent.change(input, { target: { value: 'Cork' } })
    expect(await screen.findByRole('option')).toHaveTextContent('Cork')
    await act(async () => { completeOldSearch() })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('Cork')
  })

  it('Escape closes suggestions without changing free text', async () => {
    server.use(http.get('/api/cities/search', () => HttpResponse.json({ items: [dublin] })))
    renderWithProviders(<Picker />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Dub' } })
    await screen.findByRole('option')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('Dub')
  })
})
