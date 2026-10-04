import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MediaManageGrid } from '../components/media/MediaManageGrid'
import { mediaItem } from './media-fixtures'
import { renderWithProviders } from './render'

function renderGrid(itemOverrides: Parameters<typeof mediaItem>[0] = {}, handlers: { onOpen?: ReturnType<typeof vi.fn>; onEditCaption?: ReturnType<typeof vi.fn> } = {}) {
  const item = mediaItem({ alt_text: 'Stage shot', ...itemOverrides })
  const props = {
    items: [item],
    onOpen: handlers.onOpen ?? vi.fn(),
    onEditCaption: handlers.onEditCaption ?? vi.fn(),
    onChangeAttribution: vi.fn(),
    onSoftDelete: vi.fn(),
    bulkDelete: vi.fn(),
  }
  renderWithProviders(<MediaManageGrid {...props} />)
  return { item, ...props }
}

describe('MediaManageGrid', () => {
  it('opens the lightbox on tile click — not the caption editor (design §5.3/§6.4)', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onEditCaption = vi.fn()
    const { item } = renderGrid({}, { onOpen, onEditCaption })

    await user.click(screen.getByRole('button', { name: 'Stage shot' }))
    expect(onOpen).toHaveBeenCalledWith(item)
    expect(onEditCaption).not.toHaveBeenCalled()
  })

  it('opens the caption editor only from the toolbar button', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onEditCaption = vi.fn()
    const { item } = renderGrid({}, { onOpen, onEditCaption })

    await user.click(screen.getByRole('button', { name: 'Edit caption' }))
    expect(onEditCaption).toHaveBeenCalledWith(item)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders the caption below the image, outside the aspect-locked tile button', () => {
    renderGrid({
      id: 'm-caption',
      attribution: { performer_name: 'Amy Hart', performer_city: 'Dublin', profile_id: null, profile_handle: null },
    })

    // Default short-form caption from attribution (design §7.2).
    const caption = screen.getByText('Amy Hart from Dublin')
    expect(caption).toHaveClass('media-tile-caption')
    expect(caption).toHaveClass('static')
    // Inside the button it overflowed the fixed 3:2 box onto the action row.
    expect(caption.closest('button')).toBeNull()
  })
})
