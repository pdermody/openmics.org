import { useEffect, type ReactNode } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { PublicVenueMap } from '../components/location/PublicVenueMap'
import { renderWithProviders } from './render'
import { i18n } from '../i18n'

const tileMounted = vi.fn()
const mapOptions = vi.fn()
const map = vi.hoisted(() => ({
  invalidateSize: vi.fn(),
  getContainer: () => document.body,
}))
vi.mock('react-leaflet', () => ({
  useMap: () => map,
  MapContainer: ({ children, scrollWheelZoom }: { children: ReactNode; scrollWheelZoom: boolean }) => {
    mapOptions(scrollWheelZoom)
    return <div>{children}</div>
  },
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: ({ eventHandlers }: { eventHandlers: { tileerror: () => void } }) => {
    useEffect(() => { tileMounted() }, [])
    return <button type="button" onClick={eventHandlers.tileerror}>Fail tile</button>
  },
}))

it('updates Leaflet measurements when the modal resizes and disconnects on close', () => {
  let resize = () => {}
  const observe = vi.fn()
  const disconnect = vi.fn()
  const OriginalResizeObserver = window.ResizeObserver
  window.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resize = () => callback([], this) }
    observe = observe
    disconnect = disconnect
    unobserve() {}
  }
  try {
    const { unmount } = renderWithProviders(<PublicVenueMap lat={0} lng={0} name="The Venue" address="1 Main Street" />)
    expect(observe).toHaveBeenCalledWith(document.body)
    resize()
    expect(map.invalidateSize).toHaveBeenCalledWith({ pan: false })
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  } finally {
    window.ResizeObserver = OriginalResizeObserver
  }
})

it('reports tile failures and remounts the map on retry', async () => {
  tileMounted.mockClear()
  renderWithProviders(<PublicVenueMap lat={0} lng={0} name="The Venue" address="1 Main Street" />)
  expect(tileMounted).toHaveBeenCalledTimes(1)
  expect(mapOptions).toHaveBeenCalledWith(true)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Fail tile' }))
  expect(screen.getByRole('alert')).toHaveTextContent('The venue map could not load.')
  await userEvent.setup().click(screen.getByRole('button', { name: i18n.t('discoveryRetry') }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(tileMounted).toHaveBeenCalledTimes(2)
})
