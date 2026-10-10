import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FeaturedStrip } from '../components/media/FeaturedStrip'
import { mediaItem } from './media-fixtures'
import { renderWithProviders } from './render'

it('hides arrows when all featured items fit', () => {
  renderWithProviders(<FeaturedStrip items={[mediaItem()]} onOpen={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Previous media' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Next media' })).not.toBeInTheDocument()
})

it('shows only directions with more content and remeasures on resize', async () => {
  let resize = () => {}
  const observe = ResizeObserver.prototype.observe
  vi.spyOn(ResizeObserver.prototype, 'observe').mockImplementation(function (this: ResizeObserver, element) {
    resize = () => observe.call(this, element)
  })
  renderWithProviders(<FeaturedStrip items={[mediaItem({ id: 'one' }), mediaItem({ id: 'two' })]} onOpen={vi.fn()} />)
  const rail = screen.getByRole('group')
  Object.defineProperties(rail, {
    clientWidth: { configurable: true, value: 260 },
    scrollWidth: { configurable: true, value: 532 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  })
  fireEvent.scroll(rail)
  expect(await screen.findByRole('button', { name: 'Next media' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Previous media' })).not.toBeInTheDocument()
  rail.scrollLeft = 272
  fireEvent.scroll(rail)
  expect(await screen.findByRole('button', { name: 'Previous media' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Next media' })).not.toBeInTheDocument()
  rail.scrollLeft = 0
  Object.defineProperty(rail, 'clientWidth', { value: 800 })
  resize()
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Previous media' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next media' })).not.toBeInTheDocument()
  })
})
