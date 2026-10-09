import { createElement, forwardRef, useImperativeHandle, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocationPicker } from '../components/location/LocationPicker'
import { renderWithProviders } from './render'

const { map } = vi.hoisted(() => ({
  map: {
    setView: vi.fn(),
    getZoom: vi.fn(() => 6),
    invalidateSize: vi.fn(),
    getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 280 })),
  },
}))

vi.mock('react-leaflet', () => ({
  MapContainer: forwardRef(({ children }: { children: ReactNode }, ref) => {
    useImperativeHandle(ref, () => map)
    return createElement('div', null, children)
  }),
  Marker: () => null,
  TileLayer: () => null,
  useMap: () => map,
  useMapEvents: () => null,
}))

vi.mock('../features/location', () => ({
  useGeocoding: () => ({
    assistDisabled: true,
    candidates: [],
    searching: false,
    search: vi.fn(),
    clearCandidates: vi.fn(),
  }),
}))

describe('LocationPicker map viewport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    map.getZoom.mockReturnValue(6)
  })

  it('centers the map on initial and updated coordinates', () => {
    const onChange = vi.fn()
    const { rerender } = renderWithProviders(
      <LocationPicker lat={53.35} lng={-6.26} addressQuery="" onChange={onChange} />,
    )
    expect(map.setView).toHaveBeenCalledWith([53.35, -6.26], 15)
    expect(map.invalidateSize).toHaveBeenCalledWith({ pan: false })

    rerender(<LocationPicker lat={51.5} lng={-0.1} addressQuery="" onChange={onChange} />)
    expect(map.setView).toHaveBeenLastCalledWith([51.5, -0.1], 15)
    expect(map.invalidateSize).toHaveBeenCalledTimes(4)
  })
})
